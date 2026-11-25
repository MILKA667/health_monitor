import { useCallback, useEffect, useState } from 'react'
import { getThresholds, saveThresholds } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatTime } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const COLUMNS = [
  { key: 'critLow', field: 'crit_low', label: 'Критично ниже' },
  { key: 'warnLow', field: 'warn_low', label: 'Внимание ниже' },
  { key: 'warnHigh', field: 'warn_high', label: 'Внимание выше' },
  { key: 'critHigh', field: 'crit_high', label: 'Критично выше' },
]

function parseValue(text) {
  const trimmed = String(text ?? '').trim().replace(',', '.')
  if (!trimmed) return null
  const number = Number(trimmed)
  return Number.isNaN(number) ? NaN : number
}

function rowProblem(values) {
  const numbers = COLUMNS.map((column) => parseValue(values[column.key])).filter((value) => value !== null)
  if (numbers.some((value) => Number.isNaN(value))) return 'Пороги должны быть числами'
  for (let i = 1; i < numbers.length; i += 1) {
    if (!(numbers[i] > numbers[i - 1])) return 'Пороги должны возрастать слева направо'
  }
  return ''
}

function targetText(values) {
  const low = values.warnLow.trim() || values.critLow.trim()
  const high = values.warnHigh.trim() || values.critHigh.trim()
  if (low && high) return `от ${low} до ${high}`
  if (low) return `от ${low}`
  if (high) return `до ${high}`
  return 'не задана'
}

function draftsFrom(rows) {
  return Object.fromEntries(rows.map((row) => [
    row.metric,
    Object.fromEntries(COLUMNS.map((column) => [column.key, row.values[column.field] ?? ''])),
  ]))
}

// Пороги показателей на пациента или шаблоном на нозологию + правила эскалации
function Thresholds() {
  const [data, setData] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [pending, setPending] = useState(false)

  const load = useCallback((scope) => {
    getThresholds(scope)
      .then((payload) => {
        setData(payload)
        setDrafts(draftsFrom(payload.rows))
        setSettings(payload.settings)
        setError('')
        setSavedAt(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setPending(false))
  }, [])

  useEffect(() => load(null), [load])

  function handleScope(event) {
    const [type, raw] = event.target.value.split(':')
    setPending(true)
    load({ type, id: type === 'patient' ? Number(raw) : raw })
  }

  function setCell(metric, key, value) {
    setDrafts((current) => ({ ...current, [metric]: { ...current[metric], [key]: value } }))
    setSavedAt(null)
  }

  function setSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }))
    setSavedAt(null)
  }

  async function handleSave() {
    setPending(true)
    setError('')
    try {
      const payload = await saveThresholds({
        scope: data.scope,
        rows: data.rows.map((row) => ({ metric: row.metric, ...drafts[row.metric] })),
        settings: {
          smsRelative: settings.smsRelative,
          noDataAlert: settings.noDataAlert,
        },
      })
      setData(payload)
      setDrafts(draftsFrom(payload.rows))
      setSettings(payload.settings)
      setSavedAt(payload.savedAt)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!data || !settings) {
    return (
      <main>
        {error ? <div className="thresholds-body"><FormError>{error}</FormError></div> : <p className="thresholds__loading text-2">Загружаем пороги…</p>}
      </main>
    )
  }

  const problems = Object.fromEntries(data.rows.map((row) => [row.metric, rowProblem(drafts[row.metric])]))
  const invalid = Object.values(problems).some(Boolean)
  const scopeValue = `${data.scope.type}:${data.scope.id}`
  const status = invalid
    ? { text: 'Исправьте пороги, отмеченные красным', tone: 'bad' }
    : savedAt
      ? { text: `Сохранено в ${formatTime(savedAt)} · записано в журнал аудита`, tone: 'saved' }
      : { text: 'Изменения применятся к новым измерениям', tone: 'hint' }

  return (
    <main>
      <div className="thresholds-head">
        <div className="thresholds-head__title">
          <h1>Пороги алертов</h1>
          <span className="text-2">
            Значение за критическим порогом создаёт критический алерт, за порогом внимания — алерт без эскалации
          </span>
        </div>
        <label className="thresholds-head__scope">
          <span className="thresholds__label">Применяется к</span>
          <select className="field__control field__control--sm" value={scopeValue} onChange={handleScope}>
            <optgroup label="Пациенты">
              {data.scopes.patients.map((scope) => (
                <option key={`${scope.type}:${scope.id}`} value={`${scope.type}:${scope.id}`}>{scope.label}</option>
              ))}
            </optgroup>
            <optgroup label="Шаблоны по нозологии">
              {data.scopes.nosologies.map((scope) => (
                <option key={`${scope.type}:${scope.id}`} value={`${scope.type}:${scope.id}`}>{scope.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="thresholds-body">
        <FormError>{error}</FormError>

        <div className="thresholds-grid">
          <section className="panel thresholds__table-panel" aria-label="Пороги показателей">
            <div className="thresholds__scroll">
              <div className="thresholds__table">
                <div className="thresholds__row thresholds__row--head">
                  <span>Показатель</span>
                  {COLUMNS.map((column) => (
                    <span key={column.key} className="thresholds__num">{column.label}</span>
                  ))}
                  <span>Единицы</span>
                </div>
                {data.rows.map((row) => {
                  const problem = problems[row.metric]
                  return (
                    <div key={row.metric} className={`thresholds__row${problem ? ' thresholds__row--bad' : ''}`}>
                      <span className="thresholds__metric">
                        <span className="thresholds__metric-name">{row.label}</span>
                        {problem ? (
                          <span className="thresholds__row-error">{problem}</span>
                        ) : (
                          <span className="hint">цель {targetText(drafts[row.metric])}</span>
                        )}
                      </span>
                      {COLUMNS.map((column) => (
                        <label key={column.key} className="thresholds__cell">
                          <span className="vh">{`${row.label}: ${column.label.toLowerCase()}`}</span>
                          <input
                            className={`field__control field__control--sm thresholds__input${problem ? ' thresholds__input--bad' : ''}`}
                            inputMode="decimal"
                            value={drafts[row.metric][column.key]}
                            onChange={(e) => setCell(row.metric, column.key, e.target.value)}
                          />
                        </label>
                      ))}
                      <span className="text-2">{row.unit}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="thresholds__note text-2">
              Пустое поле — порог не используется. ПСВ задаётся в процентах от лучшего результата пациента.
            </p>
          </section>

          <aside className="panel thresholds__aside" aria-labelledby="thresholds-notifications-title">
            <h2 id="thresholds-notifications-title" className="thresholds__aside-title">Уведомления</h2>

            <label className="thresholds__check">
              <input
                type="checkbox"
                checked={settings.smsRelative}
                onChange={(e) => setSetting('smsRelative', e.target.checked)}
              />
              <span className="thresholds__check-text">
                <span>SMS родственнику при критичном значении</span>
                <span className="hint">только при согласии пациента</span>
              </span>
            </label>

            <label className="thresholds__check">
              <input
                type="checkbox"
                checked={settings.noDataAlert}
                onChange={(e) => setSetting('noDataAlert', e.target.checked)}
              />
              <span className="thresholds__check-text">
                <span>Алерт «нет данных»</span>
                <span className="hint">если нет измерений 2 дня</span>
              </span>
            </label>

            <div className="thresholds__actions">
              <Button variant="primary" onClick={handleSave} disabled={invalid || pending}>
                Сохранить
              </Button>
              <span className={`thresholds__status thresholds__status--${status.tone}`}>{status.text}</span>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default Thresholds
