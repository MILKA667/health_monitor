import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { addMeasurement, getHome } from '../../api/patient'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatTime } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const CONTEXTS = [
  { id: 'fast', label: 'Натощак' },
  { id: 'after', label: 'Через 2 часа после еды' },
  { id: 'night', label: 'Перед сном' },
]

const FEELINGS = [
  { id: 'good', label: 'Чувствую себя как обычно' },
  { id: 'weak', label: 'Слабость' },
  { id: 'dizzy', label: 'Головокружение' },
  { id: 'sweat', label: 'Потливость, дрожь' },
]

const VALUE_LABELS = { glucose: 'Значение, ммоль/л', pef: 'Значение, л/мин' }

function number(text) {
  const trimmed = String(text ?? '').trim().replace(',', '.')
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isNaN(value) ? NaN : value
}

function check(home, values) {
  if (!home) return { valid: false, tone: 'info', message: '' }
  const value = number(values.value)

  if (home.kind === 'bp') {
    const lower = number(values.value2)
    if (value === null || lower === null) {
      return { valid: false, tone: 'info', message: 'Введите оба значения. Цель — ниже 140/90.' }
    }
    if (Number.isNaN(value) || Number.isNaN(lower) || value < 60 || value > 260 || lower < 30 || lower > 160 || lower >= value) {
      return { valid: false, tone: 'error', message: 'Проверьте значения: верхнее 60–260, нижнее 30–160 и меньше верхнего.' }
    }
    const crit = (home.limits.sys.crit_high !== null && value > home.limits.sys.crit_high)
      || (home.limits.dia.crit_high !== null && lower > home.limits.dia.crit_high)
    return {
      valid: true,
      tone: crit ? 'crit' : 'info',
      message: crit ? 'Выше критического порога. После сохранения врач получит уведомление сразу.' : `Цель — ${home.target}.`,
    }
  }

  if (value === null) {
    return { valid: false, tone: 'info', message: `Цель — ${home.target}.` }
  }
  const [low, high] = home.kind === 'glucose' ? [1, 35] : [50, 900]
  if (Number.isNaN(value) || value < low || value > high) {
    return { valid: false, tone: 'error', message: `Допустимо от ${low} до ${high}. Проверьте значение.` }
  }

  let crit = false
  if (home.kind === 'glucose') {
    crit = (home.limits.crit_low !== null && value < home.limits.crit_low)
      || (home.limits.crit_high !== null && value > home.limits.crit_high)
  } else if (home.pefBest && home.limits.crit_low !== null) {
    crit = (value * 100) / home.pefBest < home.limits.crit_low
  }
  return {
    valid: true,
    tone: crit ? 'crit' : 'info',
    message: crit
      ? 'Вне критического порога. После сохранения врач получит уведомление сразу.'
      : `Цель — ${home.target}.`,
  }
}

// Новый показатель: что измеряли, значение, когда и самочувствие
function PatientEntry() {
  const navigate = useNavigate()
  const [home, setHome] = useState(null)
  const [values, setValues] = useState({ value: '', value2: '' })
  const [context, setContext] = useState('fast')
  const [wellbeing, setWellbeing] = useState({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getHome()
      .then((data) => {
        setHome(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  const state = check(home, values)

  async function handleSave() {
    if (!state.valid || pending) return
    setPending(true)
    setError('')
    try {
      const result = await addMeasurement({
        kind: home.kind,
        value: values.value,
        value2: home.kind === 'bp' ? values.value2 : undefined,
        context,
        wellbeing: FEELINGS.filter((item) => wellbeing[item.id]).map((item) => item.id),
      })
      navigate(result.alert ? '/patient/alert' : '/patient')
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <div className="patient-page entry">
      <Link to="/patient" className="entry__back">← Назад</Link>
      <h1>Новый показатель</h1>

      <label className="entry__field">
        <span className="entry__label">Что измеряли</span>
        <select className="field__control field__control--lg" value={home?.kind ?? ''} disabled>
          <option>{home?.kindTitle ?? ''}</option>
        </select>
      </label>

      {home?.kind === 'bp' ? (
        <div className="entry__grid">
          <label className="entry__field">
            <span className="entry__label">Верхнее, мм рт. ст.</span>
            <input
              className="field__control field__control--lg num"
              inputMode="numeric"
              value={values.value}
              onChange={(e) => setValues({ ...values, value: e.target.value })}
            />
          </label>
          <label className="entry__field">
            <span className="entry__label">Нижнее, мм рт. ст.</span>
            <input
              className="field__control field__control--lg num"
              inputMode="numeric"
              value={values.value2}
              onChange={(e) => setValues({ ...values, value2: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <label className="entry__field">
          <span className="entry__label">{home ? VALUE_LABELS[home.kind] : 'Значение'}</span>
          <input
            className={`field__control field__control--lg num${state.tone === 'error' ? ' field__control--bad' : ''}`}
            inputMode="decimal"
            value={values.value}
            onChange={(e) => setValues({ ...values, value: e.target.value })}
          />
        </label>
      )}

      <p className={`entry__message entry__message--${state.tone}`} role="status">{state.message}</p>

      <fieldset className="entry__group">
        <legend className="entry__label">Когда</legend>
        {CONTEXTS.map((item) => (
          <label key={item.id} className="entry__option">
            <input
              type="radio"
              name="context"
              checked={context === item.id}
              onChange={() => setContext(item.id)}
            />
            {item.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="entry__group">
        <legend className="entry__label">Самочувствие (можно несколько)</legend>
        {FEELINGS.map((item) => (
          <label key={item.id} className="entry__option">
            <input
              type="checkbox"
              checked={Boolean(wellbeing[item.id])}
              onChange={(e) => setWellbeing({ ...wellbeing, [item.id]: e.target.checked })}
            />
            {item.label}
          </label>
        ))}
      </fieldset>

      <p className="entry__time patient-muted">Время замера: сегодня, <span className="num">{formatTime(new Date().toISOString())}</span>.</p>

      <FormError>{error}</FormError>

      <div className="patient-footer">
        <Button variant="primary" size="lg" onClick={handleSave} disabled={!state.valid || pending}>
          Сохранить
        </Button>
      </div>
    </div>
  )
}

export default PatientEntry
