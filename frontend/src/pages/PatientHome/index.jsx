import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getHome, toggleIntake } from '../../api/patient'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDayTime, formatTodayLong, formatTime } from '../../utils/format'
import './style.css'

function lastText(last) {
  if (!last) return 'Замеров пока нет. Внесите первый показатель.'
  return last.isToday
    ? `Последний замер сегодня в ${formatTime(last.measuredAt)}`
    : `Последний замер ${formatDayTime(last.measuredAt)}`
}

// Главная пациента: последнее значение, план на сегодня и последние измерения
function PatientHome() {
  const [home, setHome] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getHome()
      .then((data) => {
        setHome(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  async function toggle(item) {
    const done = !item.done
    const previous = home
    setHome({
      ...home,
      plan: {
        ...home.plan,
        done: home.plan.done + (done ? 1 : -1),
        items: home.plan.items.map((current) => (current.id === item.id ? { ...current, done } : current)),
      },
    })
    try {
      await toggleIntake(item.slotId, done)
    } catch (err) {
      setHome(previous)
      setError(err.message)
    }
  }

  if (!home) {
    return (
      <div className="patient-page">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем…</p>}
      </div>
    )
  }

  const { last, plan } = home

  return (
    <div className="patient-page">
      <FormError>{error}</FormError>

      <section className="patient-section" aria-labelledby="home-last">
        <h1 id="home-last">{formatTodayLong()}</h1>
        <p className="patient-muted">{lastText(last)}</p>
        {last && (
          <p className="home-value">
            <span className="home-value__label">{home.kindTitle}</span>
            <span className={`num home-value__number home-value__number--${last.level}`}>{last.value}</span>
            <span className="home-value__unit">
              {last.unit}
              {last.deviation ? ` · ${last.deviation}` : ''}
            </span>
          </p>
        )}
      </section>

      <section className="patient-section" aria-labelledby="home-plan">
        <div className="patient-section__head">
          <h2 id="home-plan">
            План на сегодня
            <span className="num home-plan__count"> · {plan.done} из {plan.total}</span>
          </h2>
          <Link to="/patient/reminders" className="patient-section__link">Настроить</Link>
        </div>
        {plan.items.length === 0 && <p className="patient-hint">Напоминаний нет.</p>}
        {plan.items.map((item) => (
          <label key={item.id} className="home-plan__item">
            <input
              type="checkbox"
              className="home-plan__check"
              checked={item.done}
              disabled={item.type !== 'medication'}
              onChange={item.type === 'medication' ? () => toggle(item) : undefined}
            />
            <span className="home-plan__text">
              <span className={item.done ? 'home-plan__title home-plan__title--done' : 'home-plan__title'}>
                {item.title}
              </span>
              <span className="home-plan__sub">{item.subtitle}</span>
            </span>
            <span className="num home-plan__time">{item.time}</span>
          </label>
        ))}
      </section>

      <section className="patient-section" aria-labelledby="home-recent">
        <div className="patient-section__head">
          <h2 id="home-recent">Последние измерения</h2>
        </div>
        {home.recent.length > 0 ? (
          <table className="home-table">
            <caption className="vh">{home.kindTitle}, {home.last?.unit}</caption>
            <tbody>
              {home.recent.map((measurement) => (
                <tr key={measurement.id}>
                  <td className="num home-table__when">{formatDayTime(measurement.measuredAt)}</td>
                  <td className={`num home-table__value home-table__value--${measurement.level}`}>{measurement.value}</td>
                  <td className="home-table__context">{measurement.context || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="patient-hint">Раньше измерений не было.</p>
        )}
        <p className="patient-hint">
          Врач видит все ваши измерения. {home.last && home.last.value ? 'Устройство передаёт данные само.' : ''}
        </p>
      </section>

      <div className="patient-footer">
        <Button variant="primary" size="lg" to="/patient/entry">Внести показатель</Button>
      </div>
    </div>
  )
}

export default PatientHome
