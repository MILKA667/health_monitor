import { useState } from 'react'
import { Link } from 'react-router'
import { register } from '../../api/auth'
import AuthLayout from '../../components/AuthLayout'
import Button from '../../components/Button'
import Choice from '../../components/Choice'
import ConsentText from '../../components/ConsentText'
import Field from '../../components/Field'
import FormError from '../../components/FormError'
import { digitsOnly } from '../../utils/password'

const ROLES = [
  { id: 'patient', label: 'Пациент — наблюдаюсь у врача' },
  { id: 'relative', label: 'Родственник — слежу за близким' },
  { id: 'doctor', label: 'Врач — наблюдаю пациентов' },
]

const TITLES = ['Заявка на доступ', 'Согласие на обработку данных', 'Заявка отправлена']

const DONE_TEXT = {
  patient: 'Администратор проверит заявку и пришлёт SMS, когда доступ откроется.',
  relative: 'Пациенту отправлен запрос на подтверждение. После его согласия придёт SMS со входом.',
  doctor: 'Администратор проверит документы и пришлёт SMS, когда доступ откроется.',
}

function Register() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ role: 'patient', name: '', phone: '', email: '', extra: '' })
  const [consents, setConsents] = useState({ personalData: false, noDiagnosis: false })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const flip = (key) => () => setConsents({ ...consents, [key]: !consents[key] })

  const needExtra = form.role !== 'patient'
  const stepOneValid =
    form.name.trim().length > 4 &&
    digitsOnly(form.phone).length >= 10 &&
    (!needExtra || form.extra.trim().length > 3)

  async function handleSend() {
    setPending(true)
    setError('')
    try {
      await register({ ...form, extra: needExtra ? form.extra : '', consents })
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout width={560} brandLink
      aside={<Link to="/login">Вход</Link>}>
      <div className="auth-title">
        <h1>{TITLES[step - 1]}</h1>
        <span className="text-2">Шаг {step} из 3</span>
      </div>

      {step === 1 && (
        <>
          <fieldset className="auth-fieldset">
            <legend>Кто вы</legend>
            {ROLES.map((role) => (
              <Choice
                key={role.id}
                type="radio"
                name="role"
                checked={form.role === role.id}
                onChange={() => setForm({ ...form, role: role.id })}
              >
                {role.label}
              </Choice>
            ))}
          </fieldset>
          <Field label="ФИО" autoComplete="name" value={form.name} onChange={set('name')} />
          <div className="auth-grid">
            <Field label="Телефон" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
            <Field
              label={<>E-mail <span className="optional">(необязательно)</span></>}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
            />
          </div>
          {form.role === 'relative' && (
            <Field
              label="ФИО пациента"
              hint="Доступ откроется после подтверждения пациентом."
              value={form.extra}
              onChange={set('extra')}
            />
          )}
          {form.role === 'doctor' && (
            <Field
              label="Специальность и место работы"
              hint="Администратор проверит диплом и сертификат."
              value={form.extra}
              onChange={set('extra')}
            />
          )}
          <div className="auth-actions auth-actions--end">
            <Button variant="primary" onClick={() => setStep(2)} disabled={!stepOneValid}>Далее</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-2">
            Согласие на обработку данных о здоровье оформляется отдельным документом, а не частью пользовательского соглашения.
          </p>
          <ConsentText>
            <span><strong>Какие данные:</strong> ФИО, контакты, показатели (глюкоза, давление, ПСВ), назначения, переписка с врачом.</span>
            <span><strong>Зачем:</strong> чтобы лечащий врач видел динамику и вовремя реагировал на критичные значения.</span>
            <span><strong>Где:</strong> только на серверах в РФ, в зашифрованном виде.</span>
            <span><strong>Кто видит:</strong> лечащий врач; дежурный врач при эскалации; близкие — только по вашему отдельному согласию.</span>
            <span><strong>Отзыв:</strong> согласие можно отозвать, обратившись к врачу или в клинику.</span>
          </ConsentText>
          <Choice checked={consents.personalData} onChange={flip('personalData')}>
            Даю согласие на обработку персональных данных, включая данные о состоянии здоровья
          </Choice>
          <Choice checked={consents.noDiagnosis} onChange={flip('noDiagnosis')}>
            Понимаю, что платформа не ставит диагноз и не заменяет очный приём
          </Choice>
          <FormError>{error}</FormError>
          <div className="auth-actions">
            <Button onClick={() => setStep(1)}>Назад</Button>
            <Button
              variant="primary"
              onClick={handleSend}
              disabled={!(consents.personalData && consents.noDiagnosis) || pending}
            >
              Отправить заявку
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p>{DONE_TEXT[form.role]}</p>
          <div>
            <Button variant="primary" to="/login">На страницу входа</Button>
          </div>
        </>
      )}
    </AuthLayout>
  )
}

export default Register
