import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  addMeasurementReminder,
  getReminders,
  setMeasurementReminder,
  setMedicationReminder,
} from '../../api/patient'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import '../../components/Field/style.css'
import './style.css'

function reminderLabel(item, enabled) {
  return `${enabled ? 'Выключить' : 'Включить'}: ${item.title}, ${item.time}`
}

// Напоминания о лекарствах и замерах: включить, выключить и добавить замер
function PatientReminders() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [time, setTime] = useState('21:00')
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    return getReminders()
      .then((payload) => {
        setData(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleMedication(item) {
    const previous = data
    const enabled = !item.enabled
    setData({
      ...data,
      medications: data.medications.map((current) => (current.id === item.id ? { ...current, enabled } : current)),
    })
    try {
      await setMedicationReminder(item.id, enabled)
    } catch (err) {
      setData(previous)
      setError(err.message)
    }
  }

  async function toggleMeasurement(item) {
    const previous = data
    const enabled = !item.enabled
    setData({
      ...data,
      measurements: data.measurements.map((current) => (current.id === item.id ? { ...current, enabled } : current)),
    })
    try {
      await setMeasurementReminder(item.id, enabled)
    } catch (err) {
      setData(previous)
      setError(err.message)
    }
  }

  async function handleAdd(event) {
    event.preventDefault()
    if (!data || pending) return
    setPending(true)
    setError('')
    try {
      await addMeasurementReminder({ kind: data.addOptions[0].id, time })
      await load()
      setFormOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!data) {
    return (
      <div className="patient-page reminders">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем напоминания…</p>}
      </div>
    )
  }

  return (
    <div className="patient-page reminders">
      <Link to="/patient" className="reminders__back">← Назад</Link>
      <h1>Напоминания</h1>
      <FormError>{error}</FormError>

      <section className="patient-section" aria-labelledby="reminders-meds">
        <h2 id="reminders-meds">Лекарства</h2>
        <p className="patient-hint">Схему назначает врач. Здесь можно только выключить напоминание.</p>
        {data.medications.length === 0 && <p className="patient-hint">Лекарств не назначено.</p>}
        {data.medications.map((item) => (
          <label key={item.id} className="reminders__item">
            <span className="reminders__text">
              <span className={item.enabled ? '' : 'reminders__title--off'}>{item.title}</span>
              <span className="reminders__sub">{item.subtitle}</span>
            </span>
            <span className="num reminders__time">{item.time}</span>
            <input
              type="checkbox"
              className="reminders__check"
              checked={item.enabled}
              aria-label={reminderLabel(item, item.enabled)}
              onChange={() => toggleMedication(item)}
            />
          </label>
        ))}
      </section>

      <section className="patient-section" aria-labelledby="reminders-meas">
        <h2 id="reminders-meas">Замеры</h2>
        {data.measurements.length === 0 && <p className="patient-hint">Напоминаний о замерах нет.</p>}
        {data.measurements.map((item) => (
          <label key={item.id} className="reminders__item">
            <span className="reminders__text">
              <span className={item.enabled ? '' : 'reminders__title--off'}>{item.title}</span>
              <span className="reminders__sub">{item.subtitle}</span>
            </span>
            <span className="num reminders__time">{item.time}</span>
            <input
              type="checkbox"
              className="reminders__check"
              checked={item.enabled}
              aria-label={reminderLabel(item, item.enabled)}
              onChange={() => toggleMeasurement(item)}
            />
          </label>
        ))}

        {!formOpen && (
          <Button className="reminders__add" onClick={() => setFormOpen(true)}>Добавить напоминание о замере</Button>
        )}

        {formOpen && (
          <form className="reminders__form" onSubmit={handleAdd}>
            <label className="reminders__field">
              <span className="reminders__label">Что измерить</span>
              <select className="field__control field__control--lg" value={data.addOptions[0].id} disabled>
                <option>{data.addOptions[0].label}</option>
              </select>
            </label>
            <label className="reminders__field">
              <span className="reminders__label">Время</span>
              <input
                className="field__control field__control--lg num"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </label>
            <div className="reminders__actions">
              <Button onClick={() => setFormOpen(false)}>Отмена</Button>
              <Button variant="primary" type="submit" disabled={pending}>Добавить</Button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

export default PatientReminders
