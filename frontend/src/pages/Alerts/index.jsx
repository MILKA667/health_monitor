import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { acceptAlert, getAlerts, undoAlert } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import TextTabs from '../../components/TextTabs'
import { formatDayTime, formatTime, minutesBetween } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const LEVELS = [
  { value: 'all', label: 'Все уровни' },
  { value: 'crit', label: 'Критично' },
  { value: 'warn', label: 'Внимание' },
  { value: 'nodata', label: 'Нет данных' },
]

const LEVEL_LABELS = { crit: 'Критично', warn: 'Внимание', nodata: 'Нет данных' }

function relativeLabel(name) {
  // «Ковалёв Дмитрий, сын» → «сын»
  return name.split(',').pop().trim()
}

function notifiedText(alert) {
  if (alert.level !== 'crit') return 'врач'
  const sms = alert.relativeSmsAt && alert.relativeName
    ? `; ${relativeLabel(alert.relativeName)} — SMS ${formatTime(alert.relativeSmsAt)}`
    : ''
  return `врач${sms}`
}

function escalationText(alert, dutyDoctor) {
  if (alert.acceptedAt) {
    const waited = minutesBetween(alert.createdAt, alert.acceptedAt)
    return `принят${waited > 0 ? ` через ${waited} мин` : ''} · ${alert.acceptedBy}`
  }
  if (alert.level !== 'crit' || !alert.escalateAt) return 'не применяется'
  if (alert.escalated) {
    return `эскалирован ${formatTime(alert.escalateAt)}${dutyDoctor ? ` · дежурный ${dutyDoctor}` : ''}`
  }
  return `ожидает · в ${formatTime(alert.escalateAt)}`
}

function escalationTone(alert) {
  if (alert.acceptedAt) return 'done'
  if (alert.level !== 'crit') return 'none'
  return alert.escalated ? 'over' : 'pending'
}

// Все алерты: открытые, закрытые и все, с фильтром уровня
function Alerts() {
  const outlet = useOutletContext()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('open')
  const [level, setLevel] = useState('all')
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState(null)

  const load = useCallback(() => {
    getAlerts()
      .then((payload) => {
        setData(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  async function toggle(alert) {
    setPendingId(alert.id)
    setError('')
    try {
      if (alert.acceptedAt) await undoAlert(alert.id)
      else await acceptAlert(alert.id)
      load()
      outlet?.refreshHeader?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  if (!data) {
    return (
      <main>
        {error ? <div className="alerts-body"><FormError>{error}</FormError></div> : <p className="alerts__loading text-2">Загружаем алерты…</p>}
      </main>
    )
  }

  const { counts, dutyDoctor } = data
  const tabs = [
    { id: 'open', label: `Открытые · ${counts.open}` },
    { id: 'closed', label: `Закрытые · ${counts.closed}` },
    { id: 'all', label: `Все · ${counts.all}` },
  ]
  const rows = data.alerts.filter((alert) => {
    const byTab = tab === 'all' || (tab === 'open' ? !alert.acceptedAt : Boolean(alert.acceptedAt))
    return byTab && (level === 'all' || alert.level === level)
  })

  return (
    <main>
      <div className="alerts-head">
        <div className="alerts-head__title">
          <h1>Алерты</h1>
          <span className="text-2">Без реакции 15 минут критический алерт уходит дежурному врачу</span>
        </div>
        <TextTabs tabs={tabs} value={tab} onChange={setTab} label="Состояние" />
        <label className="alerts-head__filter">
          <span className="vh">Уровень</span>
          <select className="field__control field__control--sm" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="alerts-body">
        <FormError>{error}</FormError>
        <section className="panel alerts" aria-label="Список алертов">
          <div className="alerts__scroll">
            <div className="alerts__table">
              <div className="alerts__row alerts__row--head">
                <span>Время</span>
                <span>Пациент</span>
                <span>Значение</span>
                <span>Правило</span>
                <span>Уведомлены</span>
                <span>Эскалация</span>
                <span>Действие</span>
              </div>
              {rows.map((alert) => {
                const open = !alert.acceptedAt
                const tone = open && alert.level !== 'nodata' ? alert.level : null
                return (
                  <div
                    key={alert.id}
                    className={`alerts__row${open && alert.level === 'crit' ? ' alerts__row--open-crit' : ''}`}
                  >
                    <span className="num alerts__time">{formatDayTime(alert.createdAt)}</span>
                    <span className="alerts__patient">
                      {alert.own ? (
                        <Link to={`/doctor/patients/${alert.patientId}`} className="alerts__name">{alert.patientName}</Link>
                      ) : (
                        <span className="alerts__name">{alert.patientName}</span>
                      )}
                      <span className="alerts__meta">{alert.diagnosis}</span>
                    </span>
                    <span>
                      {alert.value ? (
                        <>
                          <span className={`num alerts__value alerts__value--${tone ?? 'plain'}`}>{alert.value}</span>{' '}
                          <span className="alerts__unit">{alert.unit}</span>
                        </>
                      ) : (
                        <span className="alerts__meta">{LEVEL_LABELS[alert.level]}</span>
                      )}
                    </span>
                    <span className="text-2">{alert.rule}</span>
                    <span className="text-2">{notifiedText(alert)}</span>
                    <span className={`alerts__escalation alerts__escalation--${escalationTone(alert)}`}>
                      {escalationText(alert, dutyDoctor)}
                    </span>
                    <span className="alerts__action">
                      {alert.canAccept && (
                        <Button variant="danger" size="sm" onClick={() => toggle(alert)} disabled={pendingId === alert.id}>
                          Принять
                        </Button>
                      )}
                      {alert.canUndo && (
                        <Button size="sm" onClick={() => toggle(alert)} disabled={pendingId === alert.id}>
                          Отменить
                        </Button>
                      )}
                      {alert.acceptedAt && !alert.canUndo && <span className="alerts__meta">закрыт</span>}
                    </span>
                  </div>
                )
              })}
              {rows.length === 0 && <p className="alerts__empty">Нет алертов по заданным условиям.</p>}
            </div>
          </div>
        </section>
        <p className="alerts__note text-2">
          Критично — врач и родственник (при согласии пациента) уведомляются сразу; внимание — только врач, без
          эскалации. Пороги настраиваются в разделе «Пороги».
        </p>
      </div>
    </main>
  )
}

export default Alerts
