import { useEffect, useState } from 'react'
import { getLatestAlert } from '../../api/patient'
import Button from '../../components/Button'
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
  const today = new Date()
  return date.toDateString() === today.toDateString() ? `сегодня в ${formatTime(iso)}` : formatDayTime(iso)
}

// Экран после критического значения: кому сообщили, памятка врача и быстрые действия
function PatientAlert() {
  const [alert, setAlert] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getLatestAlert()
      .then((data) => {
        setAlert(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  if (!alert) {
    return (
      <div className="patient-page alert-page">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем…</p>}
      </div>
    )
  }

  const higher = alert.rule.includes('выше')
  const title = TITLES[alert.kind]?.[higher ? 'higher' : 'lower'] ?? 'Критическое значение'

  return (
    <div className="patient-page alert-page">
      <section className="alert-head" aria-labelledby="alert-title">
        <h1 id="alert-title" className="alert-head__title">{title}</h1>
        <p className="alert-head__value">
          <span className="num alert-head__number">{alert.value}</span>
          <span className="alert-head__unit">{alert.unit} · {when(alert.createdAt)}</span>
        </p>
        <p className="alert-head__threshold">
          Критический порог — {alert.threshold}. Значение сохранено и передано врачу.
        </p>
      </section>

      <section className="patient-section" aria-labelledby="alert-notified">
        <h2 id="alert-notified">Кому сообщили</h2>
        {alert.doctor && (
          <div className="alert-row">
            <span>Врач {alert.doctor.name}</span>
            <span className="alert-row__time">сигнал в <span className="num">{formatTime(alert.createdAt)}</span></span>
          </div>
        )}
        {alert.relative && alert.relativeSmsAt && (
          <div className="alert-row">
            <span>{alert.relative.label}</span>
            <span className="alert-row__time">SMS <span className="num">{formatTime(alert.relativeSmsAt)}</span></span>
          </div>
        )}
      </section>

      {alert.memo && (
        <section className="alert-memo" aria-labelledby="alert-memo-title">
          <h2 id="alert-memo-title">Памятка вашего врача</h2>
          <p>{alert.memo.text}</p>
          <p className="patient-hint">
            Составлена {alert.memo.author} {formatDate(alert.memo.createdAt)}.
            Приложение не даёт медицинских рекомендаций само.
          </p>
        </section>
      )}

      <p className="alert-page__warning">
        При потере сознания, судорогах или резком ухудшении вызывайте скорую помощь.
      </p>

      <div className="alert-actions">
        <a className="btn btn--danger btn--md alert-actions__call" href="tel:103">Вызвать скорую — 103</a>
        <div className="alert-actions__row">
          <Button size="md" to="/patient/entry">Повторный замер</Button>
          <Button size="md" to="/patient">На главную</Button>
        </div>
      </div>
    </div>
  )
}

export default PatientAlert
