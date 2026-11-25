import { useState } from 'react'
import { Link } from 'react-router'
import { changePassword } from '../../api/patient'
import Button from '../../components/Button'
import Field from '../../components/Field'
import NewPassword from '../../components/NewPassword'
import { basePasswordRules } from '../../utils/password'
import './style.css'

// Смена пароля: текущий, новый с живой проверкой, повтор и выход на других устройствах
function PatientPassword() {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [pending, setPending] = useState(false)

  const rules = [
    ...basePasswordRules(password),
    { ok: password.length > 0 && password !== current, text: 'отличается от текущего' },
  ]
  const valid = current.length > 0 && rules.every((rule) => rule.ok) && password === repeat && !pending

  async function handleSave() {
    if (!valid) return
    setPending(true)
    setError('')
    try {
      setDone(await changePassword({ currentPassword: current, password, signOutOthers }))
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="patient-page password-page">
      <Link to="/patient/profile" className="password-page__back">← Профиль</Link>
      <h1>Смена пароля</h1>

      {done ? (
        <div role="status" className="password-page__done">
          <span className="password-page__done-title">Пароль изменён</span>
          <span className="patient-hint">
            {done.othersSignedOut
              ? 'Сеансы на других устройствах завершены.'
              : 'Другие устройства остались в системе.'}
            {' '}На ваш номер отправлено SMS о смене пароля.
          </span>
          <Button variant="primary" size="lg" to="/patient/profile">Вернуться в профиль</Button>
        </div>
      ) : (
        <>
          <Field
            label="Текущий пароль"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value)
              setError('')
            }}
          />
          {error && (
            <p className="password-page__error" role="alert">
              {error}{' '}
              {error.includes('текущий') && <Link to="/recover">Забыли пароль?</Link>}
            </p>
          )}
          <NewPassword
            password={password}
            repeat={repeat}
            onPasswordChange={setPassword}
            onRepeatChange={setRepeat}
            rules={rules}
          />
          <label className="password-page__item">
            <span className="password-page__text">
              <span>Выйти на других устройствах</span>
              <span className="patient-hint">телефон, планшет</span>
            </span>
            <input
              type="checkbox"
              className="password-page__check"
              checked={signOutOthers}
              onChange={(e) => setSignOutOthers(e.target.checked)}
            />
          </label>

          <p className="patient-hint">
            После смены на номер отправлено SMS. Если пароль сменили не вы, позвоните в клинику.
          </p>

          <div className="patient-footer">
            <Button variant="primary" size="lg" onClick={handleSave} disabled={!valid}>Сохранить</Button>
          </div>
        </>
      )}
    </div>
  )
}

export default PatientPassword
