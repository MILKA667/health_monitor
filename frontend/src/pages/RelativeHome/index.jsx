import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { getRelativeHome, setRelativePush } from '../../api/relative'
import { logout } from '../../api/auth'
import FormError from '../../components/FormError'
import { formatDate, formatDayTime, formatTime } from '../../utils/format'
import './style.css'

const TITLES = {
  glucose: { lower: 'Сахар ниже допустимого', higher: 'Сахар выше допустимого' },
  bp: { lower: 'Давление ниже допустимого', higher: 'Давление выше допустимого' },
  pef: { lower: 'ПСВ ниже допустимого', higher: 'ПСВ выше допустимого' },
}

function when(iso) {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString()
    ? `сегодня в ${formatTime(iso)}`
    : formatDayTime(iso)
}

function timeline(alert) {
  const events = [{ time: alert.createdAt, text: 'Врач получил уведомление' }]
  if (alert.relativeSmsAt) events.push({ time: alert.relativeSmsAt, text: 'Вам отправлено SMS' })
  if (alert.acceptedAt) {
    events.push({ time: alert.acceptedAt, text: `Врач ${alert.acceptedBy} — алерт принят` })
  } else {
    events.push({ text: 'Ожидается реакция врача', muted: true })
  }
  return events
}

// Главная родственника: алерт близкого, последние измерения и уведомления
function RelativeHome() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getRelativeHome()
      .then((payload) => {
        setData(payload)
        setError('')
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 403) navigate('/login', { replace: true })
        else setError(err.message)
      })
  }, [navigate])

  async function togglePush(event) {
    const push = event.target.checked
    const previous = data
    setData({ ...data, notifications: { ...data.notifications, push } })
    try {
      await setRelativePush(push)
    } catch (err) {
      setData(previous)
      setError(err.message)
    }
  }

  async function handleLogout() {
    await logout().catch(() => {})
    navigate('/login')
  }

  if (!data) {
    return (
      <div className="relative-page">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем…</p>}
      </div>
    )
  }

  const { patient, alert } = data
  const title = alert
    ? TITLES[alert.kind]?.[alert.rule.includes('выше') ? 'higher' : 'lower'] ?? 'Критическое значение'
    : null

  return (
    <div className="relative-page">
      <div className="relative-topbar">
        <span className="relative-topbar__brand">HealthMonitor</span>
        <span>
          {data.viewer.name} ·{' '}
          <button type="button" className="relative-topbar__logout" onClick={handleLogout}>Выйти</button>
        </span>
      </div>

      <div className="relative-title">
        <h1>{patient.name}</h1>
        <span className="patient-hint">
          {[patient.relation, patient.diagnosis?.toLowerCase()].filter(Boolean).join(' · ')}
        </span>
      </div>

      {alert && (
        <section className="relative-alert" aria-labelledby="relative-alert-title">
          <h2 id="relative-alert-title">{title}</h2>
          <p className="relative-alert__value">
            <span className="num relative-alert__number">{alert.value}</span>
            <span className="relative-alert__unit">{alert.unit} · {when(alert.createdAt)}</span>
          </p>
          <ol className="relative-timeline">
            {timeline(alert).map((event) => (
              <li key={`${event.time}-${event.text}`} className={event.muted ? 'relative-timeline__muted' : undefined}>
                {event.time && <span className="num relative-timeline__time">{formatTime(event.time)}</span>}
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
          <div className="relative-actions">
            {patient.phone && (
              <a className="btn btn--secondary btn--md" href={`tel:+${patient.phone}`}>Позвонить</a>
            )}
            <a className="btn btn--danger btn--md" href="tel:103">Скорая — 103</a>
          </div>
        </section>
      )}

      <section className="relative-section" aria-labelledby="relative-measurements">
        <h2 id="relative-measurements">Последние измерения</h2>
        <table className="relative-table">
          <caption className="vh">{data.measurements[0]?.unit}</caption>
          <tbody>
            {data.measurements.map((measurement) => (
              <tr key={measurement.id}>
                <td className="num relative-table__when">{formatDayTime(measurement.measuredAt)}</td>
                <td className={`num relative-table__value relative-table__value--${measurement.level}`}>
                  {measurement.value}
                </td>
                <td className="relative-table__note">{measurement.deviation || 'в пределах цели'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="relative-section" aria-labelledby="relative-notifications">
        <h2 id="relative-notifications">Уведомления</h2>
        <label className="relative-item">
          <span className="relative-item__text">
            <span>Push при критичном значении</span>
            <span className="patient-hint">SMS приходят всегда</span>
          </span>
          <input
            type="checkbox"
            className="relative-item__check"
            checked={data.notifications.push}
            aria-label="Push при критичном значении"
            onChange={togglePush}
          />
        </label>
      </section>

      <p className="patient-hint">
        Доступ открыт по согласию пациента{data.consentAt ? ` от ${formatDate(data.consentAt)}` : ''}.
        Вы видите показатели и алерты, переписка с врачом вам недоступна.
      </p>

      <FormError>{error}</FormError>
    </div>
  )
}

export default RelativeHome
