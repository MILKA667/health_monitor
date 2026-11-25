import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getMe } from '../../api/auth'
import { createTelegramCode, getTelegramStatus, unlinkTelegram } from '../../api/telegram'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { ROLE_HOME } from '../../utils/roles'
import './style.css'

// Привязка Telegram: код и deep-link в бота, статус и отвязка
function Telegram() {
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [status, setStatus] = useState(null)
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([getMe(), getTelegramStatus()])
      .then(([user, telegram]) => {
        setMe(user)
        setStatus(telegram)
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 403) navigate('/login', { replace: true })
        else setError(err.message)
      })
  }, [navigate])

  useEffect(() => {
    if (!code || status?.linked) return undefined
    const timer = setInterval(() => {
      getTelegramStatus().then(setStatus).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [code, status?.linked])

  async function requestCode() {
    setBusy(true)
    setError('')
    try {
      setCode(await createTelegramCode())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    setError('')
    try {
      setStatus(await unlinkTelegram())
      setCode(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!me || !status) {
    return (
      <div className="patient-page telegram-page">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем…</p>}
      </div>
    )
  }

  return (
    <div className="patient-page telegram-page">
      <Link to={ROLE_HOME[me.role] ?? '/login'} className="telegram-page__back">← Назад</Link>
      <h1>Уведомления в Telegram</h1>
      <FormError>{error}</FormError>

      <p className="patient-hint">
        Бот {status.botUsername} присылает коды восстановления, временные пароли и алерты.
        Других каналов доставки нет: без привязки уведомления не приходят.
      </p>

      {status.linked ? (
        <section className="panel telegram-page__panel" role="status">
          <span className="telegram-page__linked">Telegram привязан</span>
          <span className="patient-hint">Уведомления приходят в этот чат с ботом.</span>
          <Button variant="secondary" size="md" onClick={unlink} disabled={busy}>
            Отвязать Telegram
          </Button>
        </section>
      ) : (
        <section className="panel telegram-page__panel">
          <span className="telegram-page__title">Привязать аккаунт</span>
          <ol className="telegram-page__steps">
            <li>Нажмите «Получить код».</li>
            <li>Откройте бота по ссылке и нажмите «Запустить».</li>
            <li>Бот подтвердит привязку — эта страница обновится сама.</li>
          </ol>
          <Button variant="primary" size="md" onClick={requestCode} disabled={busy}>
            Получить код
          </Button>

          {code && (
            <div className="telegram-page__code" role="status">
              <span className="patient-hint">Код действует {code.expiresInMinutes} минут</span>
              <span className="num telegram-page__code-value">{code.code}</span>
              <a className="btn btn--primary btn--md" href={code.deepLink}>
                Открыть @{code.botUsername}
              </a>
              <button
                type="button"
                className="link-button"
                onClick={() => navigator.clipboard?.writeText(code.code)}
              >
                Скопировать код
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default Telegram