import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getProfile, getSurveys, signConsent, submitSurvey, updateProfile } from '../../api/patient'
import { logout } from '../../api/auth'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDate } from '../../utils/format'
import './style.css'

const SURVEYS = [
  {
    kind: 'nps',
    title: 'Насколько вероятно, что вы порекомендуете сервис?',
    hint: '0 — вряд ли, 10 — точно да',
    scores: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    kind: 'csat',
    title: 'Насколько вы удовлетворены сервисом?',
    hint: '1 — совсем нет, 5 — полностью',
    scores: [1, 2, 3, 4, 5],
  },
  {
    kind: 'ces',
    title: 'Насколько легко пользоваться сервисом?',
    hint: '1 — сложно, 5 — легко',
    scores: [1, 2, 3, 4, 5],
  },
]

function relation(name) {
  return name.split(',').pop().trim()
}

// Один вопрос опроса: шкала оценок. После ответа вопрос исчезает из списка.
function SurveyQuestion({ survey, pending, onSave }) {
  return (
    <div className="survey">
      <div className="survey__head">
        <span className="survey__title">{survey.title}</span>
        <span className="survey__hint">{survey.hint}</span>
      </div>
      <div className="survey__scores" role="group" aria-label={survey.title}>
        {survey.scores.map((score) => (
          <button
            key={score}
            type="button"
            className="survey__score"
            disabled={pending}
            onClick={() => onSave(survey.kind, score)}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  )
}

// Заглушка документа согласия: текст появится позже
function ConsentModal({ consent, pending, error, onSign, onClose }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [pending, onClose])

  return (
    <div
      className="consent-modal"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div className="consent-modal__card" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <h2 id="consent-title" className="consent-modal__title">{consent.label}</h2>
        <p className="consent-modal__placeholder">
          Здесь будет текст согласия. Документ появится позже.
        </p>
        <FormError>{error}</FormError>
        <div className="consent-modal__actions">
          <Button variant="primary" onClick={onSign} disabled={pending}>
            {pending ? 'Подписываем…' : consent.signed ? 'Подписать заново' : 'Подписать'}
          </Button>
          <Button onClick={onClose} disabled={pending}>Закрыть</Button>
        </div>
      </div>
    </div>
  )
}

// Профиль пациента: врач, близкий, уведомления, согласия и безопасность
function PatientProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [surveys, setSurveys] = useState({})
  const [surveyError, setSurveyError] = useState('')
  const [savingSurvey, setSavingSurvey] = useState('')
  const [consent, setConsent] = useState(null)
  const [consentError, setConsentError] = useState('')
  const [savingConsent, setSavingConsent] = useState(false)

  useEffect(() => {
    getProfile()
      .then((data) => {
        setProfile(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    getSurveys()
      .then((data) => setSurveys(data.responses ?? {}))
      .catch(() => {})
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

  async function saveSurvey(kind, score) {
    setSurveyError('')
    setSavingSurvey(kind)
    try {
      await submitSurvey({ kind, score })
      setSurveys((current) => ({ ...current, [kind]: { score } }))
    } catch (err) {
      setSurveyError(err.message)
    } finally {
      setSavingSurvey('')
    }
  }

  function openConsent(kind, label, signed) {
    setConsent({ kind, label, signed })
    setConsentError('')
  }

  async function signSelectedConsent() {
    if (!consent) return
    setSavingConsent(true)
    setConsentError('')
    try {
      setProfile(await signConsent(consent.kind))
      setConsent(null)
    } catch (err) {
      setConsentError(err.message)
    } finally {
      setSavingConsent(false)
    }
  }

  if (!profile) {
    return (
      <div className="patient-page profile">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем профиль…</p>}
      </div>
    )
  }

  const pendingSurveys = SURVEYS.filter((survey) => !surveys[survey.kind])

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
          <span className="profile__consent">
            <span>{profile.consents.personalData ? `подписано ${formatDate(profile.consents.personalData)}` : 'не подписано'}</span>
            <button
              type="button"
              className="profile__link"
              aria-label={`${profile.consents.personalData ? 'Открыть' : 'Подписать'} согласие «Обработка данных о здоровье»`}
              onClick={() => openConsent('personal_data', 'Обработка данных о здоровье', Boolean(profile.consents.personalData))}
            >
              {profile.consents.personalData ? 'Открыть' : 'Подписать'}
            </button>
          </span>
        </div>
        {profile.relative && (
          <div className="profile__row">
            <span>Доступ родственника</span>
            <span className="profile__consent">
              <span>{profile.consents.relativeAccess ? `подписано ${formatDate(profile.consents.relativeAccess)}` : 'не подписано'}</span>
              <button
                type="button"
                className="profile__link"
                aria-label={`${profile.consents.relativeAccess ? 'Открыть' : 'Подписать'} согласие «Доступ родственника»`}
                onClick={() => openConsent('relative_sms', 'Доступ родственника', Boolean(profile.consents.relativeAccess))}
              >
                {profile.consents.relativeAccess ? 'Открыть' : 'Подписать'}
              </button>
            </span>
          </div>
        )}
        <p className="patient-hint">
          Отзыв согласия на обработку данных прекращает наблюдение. Для отзыва обратитесь к врачу или в клинику.
        </p>
      </section>

      {pendingSurveys.length > 0 && (
        <section className="profile__section" aria-labelledby="profile-surveys">
          <h2 id="profile-surveys">Оценка сервиса</h2>
          <p className="patient-hint">Ответы помогают улучшать сервис. После ответа вопрос исчезает.</p>
          <FormError>{surveyError}</FormError>
          {pendingSurveys.map((survey) => (
            <SurveyQuestion
              key={survey.kind}
              survey={survey}
              pending={savingSurvey === survey.kind}
              onSave={saveSurvey}
            />
          ))}
        </section>
      )}

      <section className="profile__section" aria-labelledby="profile-security">
        <h2 id="profile-security">Безопасность</h2>
        <div className="profile__row">
          <span>Пароль изменён {formatDate(profile.passwordChangedAt)}</span>
          <Link to="/patient/password">Сменить</Link>
        </div>
      </section>

      <button type="button" className="profile__logout" onClick={handleLogout}>Выйти из аккаунта</button>

      {consent && (
        <ConsentModal
          consent={consent}
          pending={savingConsent}
          error={consentError}
          onSign={signSelectedConsent}
          onClose={() => { if (!savingConsent) setConsent(null) }}
        />
      )}
    </div>
  )
}

export default PatientProfile
