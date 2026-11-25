import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getProfile, updateProfile } from '../../api/patient'
import { logout } from '../../api/auth'
import FormError from '../../components/FormError'
import { formatDate } from '../../utils/format'
import './style.css'

function relation(name) {
  return name.split(',').pop().trim()
}

function devicesText(devices) {
  if (devices.length === 0) return 'не подключены'
  return devices.map((device) => `${device.name.toLowerCase()} ${device.connected ? 'подключён' : 'отключён'}`).join(', ')
}

// Профиль пациента: врач, близкий, устройства, напоминания, согласия и безопасность
function PatientProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getProfile()
      .then((data) => {
        setProfile(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  async function save(changes) {
    const previous = profile
    setError('')
    try {
      setProfile(await updateProfile(changes))
    } catch (err) {
      setProfile(previous)
      setError(err.message)
    }
  }

  async function handleLogout() {
    await logout().catch(() => {})
    navigate('/login')
  }

  if (!profile) {
    return (
      <div className="patient-page profile">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем профиль…</p>}
      </div>
    )
  }

  return (
    <div className="patient-page profile">
      <div className="profile__title">
        <h1>{profile.name}</h1>
        {profile.phoneMasked && <span className="num profile__phone">{profile.phoneMasked}</span>}
      </div>
      <FormError>{error}</FormError>

      <section className="profile__section" aria-labelledby="profile-doctor">
        <h2 id="profile-doctor">Лечащий врач</h2>
        <div className="profile__row">
          <span>{[profile.doctor.name, profile.doctor.specialty].filter(Boolean).join(', ')}</span>
          <Link to="/patient/chat">Написать</Link>
        </div>
      </section>

      <section className="profile__section" aria-labelledby="profile-relative">
        <h2 id="profile-relative">Близкие</h2>
        {profile.relative ? (
          <>
            <div className="profile__row">
              <span>{profile.relative.name}</span>
              <span className="num profile__phone">{profile.relative.phoneMasked}</span>
            </div>
            <label className="profile__item">
              <span className="profile__text">
                <span>Экстренные уведомления {relation(profile.relative.name)}</span>
                <span className="profile__sub">
                  {profile.relative.smsAlerts
                    ? 'при значении вне критического порога'
                    : `выключены: ${relation(profile.relative.name)} не узнает о критичных значениях`}
                </span>
              </span>
              <input
                type="checkbox"
                className="profile__check"
                checked={profile.relative.smsAlerts}
                aria-label={`Экстренные уведомления ${relation(profile.relative.name)}`}
                onChange={(e) => save({ relativeSms: e.target.checked })}
              />
            </label>
          </>
        ) : (
          <p className="patient-hint">Близкий не указан.</p>
        )}
      </section>

      <section className="profile__section" aria-labelledby="profile-devices">
        <h2 id="profile-devices">Устройства</h2>
        <div className="profile__row">
          <span>{devicesText(profile.devices)}</span>
          <Link to="/patient/devices">Управлять</Link>
        </div>
      </section>

      <section className="profile__section" aria-labelledby="profile-channels">
        <h2 id="profile-channels">Уведомления приходят</h2>
        <label className="profile__item">
          <span className="profile__text">Push-уведомлением</span>
          <input
            type="checkbox"
            className="profile__check"
            checked={profile.channels.push}
            aria-label="Push-уведомлением"
            onChange={(e) => save({ push: e.target.checked })}
          />
        </label>
        <label className="profile__item">
          <span className="profile__text">Telegram</span>
          <input
            type="checkbox"
            className="profile__check"
            checked={profile.channels.sms}
            aria-label="Telegram"
            onChange={(e) => save({ sms: e.target.checked })}
          />
        </label>
        {!profile.channels.push && !profile.channels.sms && (
          <p className="profile__channel-error" role="alert">Выберите хотя бы один способ, иначе напоминания не придут.</p>
        )}
      </section>

      <section className="profile__section" aria-labelledby="profile-telegram">
        <h2 id="profile-telegram">Уведомления в Telegram</h2>
        <div className="profile__row">
          <span>Коды восстановления и алерты</span>
          <Link to="/telegram">Настроить</Link>
        </div>
        <p className="patient-hint">Без привязки Telegram уведомления не приходят.</p>
      </section>

      <section className="profile__section" aria-labelledby="profile-consents">
        <h2 id="profile-consents">Согласия</h2>
        <div className="profile__row">
          <span>Обработка данных о здоровье</span>
          <span>{profile.consents.personalData ? `подписано ${formatDate(profile.consents.personalData)}` : 'не подписано'}</span>
        </div>
        <div className="profile__row">
          <span>Доступ родственника</span>
          <span>{profile.consents.relativeAccess ? `подписано ${formatDate(profile.consents.relativeAccess)}` : 'не подписано'}</span>
        </div>
        <p className="patient-hint">
          Отзыв согласия на обработку данных прекращает наблюдение. Для отзыва обратитесь к врачу или в клинику.
        </p>
      </section>

      <section className="profile__section" aria-labelledby="profile-security">
        <h2 id="profile-security">Безопасность</h2>
        <div className="profile__row">
          <span>Пароль изменён {formatDate(profile.passwordChangedAt)}</span>
          <Link to="/patient/password">Сменить</Link>
        </div>
      </section>

      <button type="button" className="profile__logout" onClick={handleLogout}>Выйти из аккаунта</button>
    </div>
  )
}

export default PatientProfile
