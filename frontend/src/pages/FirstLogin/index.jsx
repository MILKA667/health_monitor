import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { completeWelcome, getWelcomeProfile, logout } from '../../api/auth'
import AuthLayout from '../../components/AuthLayout'
import Button from '../../components/Button'
import Choice from '../../components/Choice'
import ConsentText from '../../components/ConsentText'
import Field from '../../components/Field'
import FormError from '../../components/FormError'
import NewPassword from '../../components/NewPassword'
import StepProgress from '../../components/StepProgress'
import { basePasswordRules, digitsOnly } from '../../utils/password'
import './style.css'

const TITLES = ['Добро пожаловать', 'Придумайте пароль', 'Согласия']

function FirstLogin() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [step, setStep] = useState(1)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [consents, setConsents] = useState({ personalData: false, noDiagnosis: false })
  const [relativeOn, setRelativeOn] = useState(false)
  const [relative, setRelative] = useState({ name: '', phone: '' })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getWelcomeProfile()
      .then(setProfile)
      .catch((err) => setLoadError(err.message))
  }, [])

  // Пароль не должен содержать последние цифры телефона и год рождения
  const phoneTail = digitsOnly(profile?.phoneMasked ?? '').slice(-4)
  const birthYear = (profile?.birthDate ?? '').slice(-4)
  const rules = [
    ...basePasswordRules(password),
    {
      ok:
        password.length > 0 &&
        (!phoneTail || !password.includes(phoneTail)) &&
        (!birthYear || !password.includes(birthYear)),
      text: 'без номера телефона и года рождения',
    },
  ]
  const passwordValid = rules.every((rule) => rule.ok) && password === repeat
  const relativeValid = !relativeOn || (relative.name.trim().length > 1 && digitsOnly(relative.phone).length >= 10)
  const consentsValid = consents.personalData && consents.noDiagnosis && relativeValid

  const flip = (key) => () => setConsents({ ...consents, [key]: !consents[key] })

  async function handleLogout() {
    await logout().catch(() => {})
    navigate('/login')
  }

  async function handleComplete() {
    setPending(true)
    setError('')
    try {
      await completeWelcome({ password, consents, relative: relativeOn ? relative : null })
      setStep(4)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout width={560} aside={<button type="button" className="link-button" onClick={handleLogout}>Выйти</button>}>
      {!profile ? (
        loadError ? <FormError>{loadError}</FormError> : <p className="text-2">Загружаем данные…</p>
      ) : (
        <>
          {step < 4 && (
            <div className="first-login__head">
              <StepProgress step={step} />
              <div className="auth-title">
                <h1>{TITLES[step - 1]}</h1>
                <span className="text-2">Шаг {step} из 3</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <>
              <p className="text-2">
                Учётную запись создала клиника. Проверьте, что данные ваши, — по ним врач свяжется с вами при критичном значении.
              </p>
              <dl className="first-login__data">
                <div><dt>ФИО</dt><dd>{profile.name}</dd></div>
                <div><dt>Дата рождения</dt><dd className="num">{profile.birthDate}</dd></div>
                <div><dt>Телефон</dt><dd className="num">{profile.phoneMasked}</dd></div>
                <div><dt>Лечащий врач</dt><dd>{profile.doctor.shortName}, {profile.doctor.specialty}</dd></div>
                <div><dt>Клиника</dt><dd>{profile.clinic}</dd></div>
              </dl>
              <p className="text-2">
                Нашли ошибку? Позвоните в регистратуру: <a className="num" href="tel:+70000000000">+7 (000) 000-00-00</a>. До исправления продолжать нельзя.
              </p>
              <div className="auth-actions auth-actions--end">
                <Button variant="primary" onClick={() => setStep(2)}>Данные верны</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-2">Пароль из SMS временный. Придумайте свой — дальше входите только с ним.</p>
              <NewPassword
                password={password}
                repeat={repeat}
                onPasswordChange={setPassword}
                onRepeatChange={setRepeat}
                rules={rules}
              />
              <div className="auth-actions">
                <Button onClick={() => setStep(1)}>Назад</Button>
                <Button variant="primary" onClick={() => setStep(3)} disabled={!passwordValid}>Далее</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <ConsentText maxHeight={160}>
                <span><strong>Какие данные:</strong> ФИО, контакты, показатели (глюкоза, давление, ПСВ), назначения, переписка с врачом.</span>
                <span><strong>Кто видит:</strong> лечащий врач; дежурный врач при эскалации; близкие — только по отдельному согласию ниже.</span>
                <span><strong>Где:</strong> только на серверах в РФ, в зашифрованном виде.</span>
              </ConsentText>
              <Choice checked={consents.personalData} onChange={flip('personalData')}>
                Даю согласие на обработку персональных данных, включая данные о состоянии здоровья{' '}
                <span className="required" aria-hidden="true">*</span>
                <span className="vh">(обязательно)</span>
              </Choice>
              <Choice checked={consents.noDiagnosis} onChange={flip('noDiagnosis')}>
                Понимаю, что платформа не ставит диагноз и не заменяет очный приём{' '}
                <span className="required" aria-hidden="true">*</span>
                <span className="vh">(обязательно)</span>
              </Choice>

              <fieldset className="auth-fieldset first-login__relative">
                <legend>Близкий человек <span className="optional">(необязательно)</span></legend>
                <Choice checked={relativeOn} onChange={() => setRelativeOn(!relativeOn)}>
                  Отправлять SMS близкому, если показатель выйдет за критический порог
                </Choice>
                {relativeOn && (
                  <>
                    <div className="auth-grid">
                      <Field
                        label="Имя и кем приходится"
                        placeholder="Дмитрий, сын"
                        value={relative.name}
                        onChange={(e) => setRelative({ ...relative, name: e.target.value })}
                      />
                      <Field
                        label="Телефон"
                        type="tel"
                        value={relative.phone}
                        onChange={(e) => setRelative({ ...relative, phone: e.target.value })}
                      />
                    </div>
                    <span className="hint">
                      Близкий получит SMS с приглашением и увидит только критичные события и реакцию врача — не все измерения.
                    </span>
                  </>
                )}
              </fieldset>
              <p className="hint"><span className="first-login__star">*</span> обязательно для начала наблюдения</p>
              <FormError>{error}</FormError>
              <div className="auth-actions">
                <Button onClick={() => setStep(2)}>Назад</Button>
                <Button variant="primary" onClick={handleComplete} disabled={!consentsValid || pending}>
                  Подписать и продолжить
                </Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="first-login__done-title">Всё готово</h1>
              <p>
                {profile.doctor.name} теперь видит ваши измерения. Если значение выйдет за опасную границу, врач узнает об
                этом сразу{relativeOn ? ', а близкому придёт SMS' : ''}.
              </p>
              <ul className="first-login__next text-2">
                <li>Подключите глюкометр — замеры будут передаваться сами.</li>
                <li>Напоминания о лекарствах врач уже настроил, их можно изменить.</li>
                <li>Писать врачу можно в чате, ответ — в рабочие часы.</li>
              </ul>
              <div className="first-login__links">
                <Button variant="primary" to="/patient">Перейти в приложение</Button>
                <Button to="/patient/devices">Подключить глюкометр</Button>
              </div>
            </>
          )}
        </>
      )}
    </AuthLayout>
  )
}

export default FirstLogin
