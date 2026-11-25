import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { requestRecoveryCode, resetPassword, verifyRecoveryCode } from '../../api/auth'
import AuthLayout from '../../components/AuthLayout'
import Button from '../../components/Button'
import Field from '../../components/Field'
import FormError from '../../components/FormError'
import NewPassword from '../../components/NewPassword'
import { basePasswordRules, digitsOnly, isLogin } from '../../utils/password'
import './style.css'

const TITLES = ['Восстановление пароля', 'Введите код', 'Новый пароль', 'Готово']
const RESEND_DELAY = 60

function Recover() {
  const [step, setStep] = useState(1)
  const [login, setLogin] = useState('')
  const [masked, setMasked] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [locked, setLocked] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  // Обратный отсчёт до повторной отправки кода
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const trimmedLogin = login.trim()
  const loginDigits = digitsOnly(trimmedLogin)
  const rules = [
    ...basePasswordRules(password),
    {
      ok: password.length > 0 && password !== trimmedLogin && (!loginDigits || !password.includes(loginDigits)),
      text: 'не совпадает с телефоном или e-mail',
    },
  ]
  const passwordValid = rules.every((rule) => rule.ok) && password === repeat

  async function run(action) {
    setPending(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      const result = await requestRecoveryCode(trimmedLogin)
      setMasked(result.masked)
      setCode('')
      setCodeError('')
      setLocked(false)
      setResendIn(RESEND_DELAY)
      setStep(2)
    })

  async function checkCode() {
    setPending(true)
    setError('')
    try {
      const result = await verifyRecoveryCode(trimmedLogin, code)
      setToken(result.token)
      setStep(3)
    } catch (err) {
      const attemptsLeft = err.data?.attemptsLeft
      if (attemptsLeft === undefined) {
        setError(err.message)
      } else if (attemptsLeft <= 0) {
        setLocked(true)
        setCodeError('Слишком много неверных попыток. Запросите новый код.')
      } else {
        setCodeError(`Неверный код. Осталось попыток: ${attemptsLeft}.`)
      }
    } finally {
      setPending(false)
    }
  }

  const savePassword = () =>
    run(async () => {
      await resetPassword(token, password)
      setStep(4)
    })

  function backToLogin() {
    setStep(1)
    setCode('')
    setCodeError('')
    setLocked(false)
    setError('')
  }

  return (
    <AuthLayout
      width={440}
      brandLink
      aside={<Link to="/login">Вход</Link>}
      footnote="Если доступа к телефону нет, восстановить вход может только администратор клиники после проверки личности."
    >
      <div className="auth-title">
        <h1>{TITLES[step - 1]}</h1>
        {step < 4 && <span className="text-2">Шаг {step} из 3</span>}
      </div>

      {step === 1 && (
        <>
          <p className="text-2">Укажите телефон или e-mail, с которым входите. Пришлём код для сброса пароля.</p>
          <Field
            label="Телефон или e-mail"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <FormError>{error}</FormError>
          <div className="auth-actions">
            <Link to="/login">Вернуться ко входу</Link>
            <Button variant="primary" onClick={sendCode} disabled={!isLogin(login) || pending}>Получить код</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-2">
            Код отправлен на <span className="num recover__masked">{masked}</span>. Он действует 10 минут.
          </p>
          <Field
            label="Код из SMS"
            className="recover__code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (!locked) setCodeError('')
            }}
            disabled={locked}
            error={codeError}
          />
          <div className="recover__resend">
            <button type="button" className="link-button" onClick={sendCode} disabled={resendIn > 0 || pending}>
              Отправить код ещё раз
            </button>
            {resendIn > 0 && (
              <span className="hint">
                повторно через <span className="num">0:{String(resendIn).padStart(2, '0')}</span>
              </span>
            )}
          </div>
          <FormError>{error}</FormError>
          <div className="auth-actions">
            <Button onClick={backToLogin}>Назад</Button>
            <Button
              variant="primary"
              onClick={checkCode}
              disabled={locked || digitsOnly(code).length !== 6 || pending}
            >
              Подтвердить
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <NewPassword
            password={password}
            repeat={repeat}
            onPasswordChange={setPassword}
            onRepeatChange={setRepeat}
            rules={rules}
          />
          <FormError>{error}</FormError>
          <div className="auth-actions auth-actions--end">
            <Button variant="primary" onClick={savePassword} disabled={!passwordValid || pending}>Сохранить пароль</Button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <p>
            Пароль изменён. Мы завершили все открытые сеансы на других устройствах и отправили SMS-уведомление о смене пароля.
          </p>
          <p className="text-2">
            Если это были не вы, позвоните в клинику: <a className="num" href="tel:+70000000000">+7 (000) 000-00-00</a>.
          </p>
          <div>
            <Button variant="primary" to="/login">Войти с новым паролем</Button>
          </div>
        </>
      )}
    </AuthLayout>
  )
}

export default Recover
