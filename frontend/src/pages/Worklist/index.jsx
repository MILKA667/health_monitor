import { useCallback, useEffect, useMemo, useState } from 'react'
import { getWorklist } from '../../api/doctor'
import FormError from '../../components/FormError'
import Panel from '../../components/Panel'
import ValueCell from '../../components/ValueCell'
import WorklistGroup from '../../components/WorklistGroup'
import { daysSince, formatShort, formatTime, formatToday, NOSOLOGY_FULL, NOSOLOGY_SHORT, patientMeta, plural } from '../../utils/format'
import PatientSummary from './PatientSummary'
import '../../components/Field/style.css'
import './style.css'

const GROUPS = [
  { level: 'crit', label: 'Критично — требуется действие' },
  { level: 'warn', label: 'Требуют внимания' },
  { level: 'none', label: 'Нет данных более 2 дней' },
  { level: 'ok', label: 'В пределах цели' },
]

const REFRESH_MS = 60000

// Состояние критического алерта в строке списка
function alertState(alert) {
  if (!alert) return { text: '—' }
  if (alert.acceptedAt) return { text: `Принят в ${formatTime(alert.acceptedAt)}` }
  if (alert.escalated) return { text: `Эскалирован в ${formatTime(alert.escalateAt)}`, tone: 'over' }
  return { text: `Не принят · эскал. ${formatTime(alert.escalateAt)}`, tone: 'pending' }
}

function deviationText(patient) {
  if (!patient.last) return 'нет измерений'
  if (patient.level === 'none') {
    const days = daysSince(patient.last.measuredAt)
    return `нет данных ${days} ${plural(days, 'день', 'дня', 'дней')}`
  }
  return patient.last.deviation ?? '—'
}

function Worklist() {
  const [patients, setPatients] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [nosology, setNosology] = useState('all')
  const [closed, setClosed] = useState({ ok: true })
  const [selectedId, setSelectedId] = useState(null)

  const load = useCallback(() => {
    getWorklist()
      .then((data) => {
        setPatients(data.patients)
        setUpdatedAt(new Date())
        setError('')
        // По умолчанию открыт первый пациент списка — самый срочный
        setSelectedId((current) => current ?? data.patients[0]?.id ?? null)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (patients ?? []).filter(
      (p) => (nosology === 'all' || p.nosology === nosology) && (!q || p.name.toLowerCase().includes(q)),
    )
  }, [patients, query, nosology])

  return (
    <main>
      <div className="page-head">
        <h1>Пациенты</h1>
        {updatedAt && (
          <span className="text-2">
            {formatToday(updatedAt)} · обновлено в <span className="num">{formatTime(updatedAt)}</span>
          </span>
        )}
        <div className="page-head__filters">
          <label>
            <span className="vh">Поиск по ФИО</span>
            <input
              type="search"
              className="field__control field__control--sm worklist__search"
              placeholder="Поиск по ФИО"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="vh">Нозология</span>
            <select
              className="field__control field__control--sm"
              value={nosology}
              onChange={(e) => setNosology(e.target.value)}
            >
              <option value="all">Все нозологии</option>
              {Object.entries(NOSOLOGY_FULL).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="page-body">
        <Panel aria-label="Рабочий список" className="worklist">
          <FormError>{error}</FormError>
          <div className="worklist__scroll">
            <div className="worklist__table">
              <div className="worklist__row worklist__row--head">
                <span>Пациент</span><span>Нозология</span><span>Последний показатель</span>
                <span>Отклонение</span><span>Время</span><span>Алерт</span>
              </div>
              {GROUPS.map((group) => {
                const rows = visible.filter((p) => p.level === group.level)
                if (rows.length === 0) return null
                return (
                  <WorklistGroup
                    key={group.level}
                    level={group.level}
                    label={group.label}
                    count={rows.length}
                    open={!closed[group.level]}
                    onToggle={() => setClosed({ ...closed, [group.level]: !closed[group.level] })}
                  >
                    {rows.map((p) => {
                      const state = alertState(p.alert)
                      const tone = p.level === 'none' ? undefined : p.last?.level
                      return (
                        <div key={p.id} className={`worklist__row${p.id === selectedId ? ' worklist__row--selected' : ''}`}>
                          <div className="worklist__patient">
                            <button
                              type="button"
                              className="worklist__name"
                              aria-pressed={p.id === selectedId}
                              onClick={() => setSelectedId(p.id)}
                            >
                              {p.name}
                            </button>
                            <span className="worklist__meta">{patientMeta(p)}</span>
                          </div>
                          <span className="text-2">{NOSOLOGY_SHORT[p.nosology]}</span>
                          <span>{p.last ? <ValueCell value={p.last.value} unit={p.last.unit} level={tone} /> : '—'}</span>
                          <span className={`num worklist__deviation${tone ? ` worklist__deviation--${tone}` : ''}`}>
                            {deviationText(p)}
                          </span>
                          <span className="num text-2">{p.last ? formatShort(p.last.measuredAt) : '—'}</span>
                          <span className={`worklist__alert${state.tone ? ` worklist__alert--${state.tone}` : ''}`}>
                            {state.text}
                          </span>
                        </div>
                      )
                    })}
                  </WorklistGroup>
                )
              })}
              {patients && visible.length === 0 && (
                <p className="worklist__empty">Нет пациентов по заданным условиям.</p>
              )}
            </div>
          </div>
        </Panel>

        {selectedId && <PatientSummary patientId={selectedId} onChange={load} />}
      </div>
    </main>
  )
}

export default Worklist
