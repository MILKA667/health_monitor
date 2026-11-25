import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { login as loginRequest } from '../../api/auth'
import AuthLayout from '../../components/AuthLayout'
import Button from '../../components/Button'
import Field from '../../components/Field'
import FormError from '../../components/FormError'
import { ROLE_HOME } from '../../utils/roles'
import './style.css'

function Login() {
  const navigate = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const canSubmit = login.trim().length > 3 && password.length > 0 && !pending

  // Роль и временный пароль определяет учётная запись на сервере
  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return

    setPending(true)
    setError('')
    try {
      const user = await loginRequest(login.trim(), password)
      navigate(user.mustChangePassword ? '/welcome' : ROLE_HOME[user.role] ?? '/login')
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <AuthLayout
      width={400}
      subtitle="Удалённое наблюдение за пациентами с диабетом, гипертонией и астмой"
      footnote="Данные хранятся и обрабатываются на серверах в РФ. Платформа не ставит диагноз и не заменяет очный приём."
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h1 className="login__title">Вход</h1>
        <Field
          label="Телефон или e-mail"
          autoComplete="username"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
        <Field
          label="Пароль"
          aside={<Link to="/recover">Забыли пароль?</Link>}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" className="login__submit" disabled={!canSubmit}>Войти</Button>
        <span className="text-2">Нет доступа? <Link to="/register">Подать заявку</Link></span>
      </form>
    </AuthLayout>
  )
}

export default Login
