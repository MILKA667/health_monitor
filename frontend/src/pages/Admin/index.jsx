import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  approveApplication,
  deleteUser,
  getApplications,
  getAudit,
  getUsers,
  rejectApplication,
  resetUserPassword,
  revertApplication,
  setUserBlocked,
} from '../../api/admin'
import { getMe, logout } from '../../api/auth'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import TextTabs from '../../components/TextTabs'
import { formatDayTime, formatDate } from '../../utils/format'
import { ROLE_HOME } from '../../utils/roles'
import Analytics from './Analytics'
import '../../components/Field/style.css'
import './style.css'

const ROLE_FILTERS = [
  { value: 'all', label: 'Все роли' },
  { value: 'doctor', label: 'Врачи' },
  { value: 'patient', label: 'Пациенты' },
  { value: 'relative', label: 'Родственники' },
  { value: 'admin', label: 'Администраторы' },
]

const EMPTY_FORM = {
  doctorId: '', birthDate: '', sex: '', nosology: '', diagnosis: '', icdCode: '',
  patientId: '', specialty: '', clinic: '',
}

function documents(application) {
  const parts = [application.consentGiven ? 'согласия получены' : 'согласия не получены']
  if (application.extra) parts.push(application.extra)
  return parts.join(' · ')
}

// Админка: заявки на доступ, пользователи и неизменяемый журнал аудита
function Admin() {
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('applications')
  const [apps, setApps] = useState(null)
  const [users, setUsers] = useState(null)
  const [audit, setAudit] = useState(null)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [auditType, setAuditType] = useState('all')
  const [approving, setApproving] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetInfo, setResetInfo] = useState(null)

  const loadApps = useCallback(() => {
    return getApplications()
      .then((payload) => {
        setApps(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    getMe()
      .then((user) => {
        if (user.role !== 'admin') navigate(ROLE_HOME[user.role] ?? '/login', { replace: true })
        else setMe(user)
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 403) navigate('/login', { replace: true })
        else setError(err.message)
      })
  }, [navigate])

  useEffect(() => {
    if (me) loadApps()
  }, [me, loadApps])

  useEffect(() => {
    if (!me || tab !== 'users') return
    getUsers({ search, role })
      .then((payload) => setUsers(payload.users))
      .catch((err) => setError(err.message))
  }, [me, tab, search, role])

  useEffect(() => {
    if (!me || tab !== 'audit') return
    getAudit(auditType)
      .then((payload) => setAudit(payload))
      .catch((err) => setError(err.message))
  }, [me, tab, auditType])

  async function handleLogout() {
    await logout().catch(() => {})
    navigate('/login')
  }

  function startApprove(application) {
    setApproving(application.id)
    setForm({
      ...EMPTY_FORM,
      doctorId: apps?.doctors[0]?.id ?? '',
      patientId: apps?.patients[0]?.id ?? '',
      sex: apps?.sexes[0]?.id ?? '',
      nosology: apps?.nosologies[0]?.id ?? '',
    })
    setError('')
  }

  function formValid(application) {
    if (application.role === 'patient') {
      return form.doctorId && form.birthDate && form.sex && form.nosology
        && form.diagnosis.trim().length >= 3 && form.icdCode.trim().length >= 2
    }
    if (application.role === 'relative') return Boolean(form.patientId)
    return form.specialty.trim().length >= 3 && form.clinic.trim().length >= 3
  }

  async function submitDecision(action) {
    setBusy(true)
    setError('')
    try {
      if (action.type === 'approve') {
        await approveApplication(action.id, {
          doctorId: Number(form.doctorId) || undefined,
          birthDate: form.birthDate || undefined,
          sex: form.sex || undefined,
          nosology: form.nosology || undefined,
          diagnosis: form.diagnosis.trim() || undefined,
          icdCode: form.icdCode.trim() || undefined,
          patientId: Number(form.patientId) || undefined,
          specialty: form.specialty.trim() || undefined,
          clinic: form.clinic.trim() || undefined,
        })
        setApproving(null)
      } else if (action.type === 'reject') {
        await rejectApplication(action.id)
      } else {
        await revertApplication(action.id)
      }
      await loadApps()
      setUsers(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleBlock(user) {
    setError('')
    try {
      await setUserBlocked(user.id, !user.blocked)
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, blocked: !user.blocked } : item)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function resetPassword(user) {
    setError('')
    setResetInfo(null)
    try {
      setResetInfo(await resetUserPassword(user.id))
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeUser(user) {
    const confirmed = window.confirm(
      `Удалить аккаунт «${user.name}»? Вход станет невозможен, контакты будут очищены. `
      + 'Медицинские данные и журнал аудита сохранятся.',
    )
    if (!confirmed) return
    setError('')
    try {
      await deleteUser(user.id)
      setUsers((current) => current.filter((item) => item.id !== user.id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (!me) {
    return <div className="admin-page">{error ? <FormError>{error}</FormError> : null}</div>
  }

  const pending = (apps?.applications ?? []).filter((application) => application.status === 'pending').length
  const tabs = [
    { id: 'applications', label: pending ? `Заявки · ${pending}` : 'Заявки' },
    { id: 'users', label: 'Пользователи' },
    { id: 'audit', label: 'Журнал аудита' },
    { id: 'analytics', label: 'Аналитика' },
  ]

  return (
    <div className="admin-page">
      <header className="admin-header">
        <span className="admin-header__brand">HealthMonitor</span>
        <TextTabs tabs={tabs} value={tab} onChange={setTab} label="Разделы админки" />
        <span className="admin-header__user">
          {me.shortName} · <Link to="/telegram">Telegram</Link> ·{' '}
          <button type="button" className="admin-header__logout" onClick={handleLogout}>Выйти</button>
        </span>
      </header>

      <main className="admin-main">
        <FormError>{error}</FormError>

        {tab === 'applications' && (
          <>
            <p className="admin-note">
              Доступ к данным пациентов открывается только после проверки документов врача и согласия пациента
              на доступ родственника.
            </p>
            <section className="panel admin-panel" aria-label="Заявки">
              <div className="admin-scroll">
                <table className="data-table admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Заявитель</th>
                      <th scope="col">Роль</th>
                      <th scope="col">Подана</th>
                      <th scope="col">Документы</th>
                      <th scope="col">Решение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(apps?.applications ?? []).map((application) => (
                      <tr key={application.id}>
                        <td>
                          <span className="admin-name">{application.name}</span>
                          <span className="admin-sub">{application.email || application.phoneMasked}</span>
                        </td>
                        <td>{application.roleLabel}</td>
                        <td className="num">{formatDate(application.createdAt)}</td>
                        <td className={application.consentGiven ? 'admin-sub' : 'admin-bad'}>{documents(application)}</td>
                        <td>
                          {application.status === 'pending' && (
                            <div className="admin-actions">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => startApprove(application)}
                                disabled={!application.consentGiven}
                              >
                                Одобрить
                              </Button>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => submitDecision({ type: 'reject', id: application.id })}
                              >
                                Отклонить
                              </Button>
                            </div>
                          )}
                          {application.status !== 'pending' && (
                            <span className={application.status === 'approved' ? 'admin-decision' : 'admin-decision admin-bad'}>
                              {application.status === 'approved' ? 'Одобрено' : 'Отклонено'}
                              {application.decidedAt ? ` ${formatDayTime(application.decidedAt)}` : ''}{' '}
                              <button
                                type="button"
                                className="link-button"
                                disabled={busy}
                                onClick={() => submitDecision({ type: 'revert', id: application.id })}
                              >
                                отменить
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(apps?.applications ?? []).length === 0 && <p className="admin-empty">Заявок нет.</p>}
              </div>
            </section>

            {approving && (() => {
              const application = apps.applications.find((item) => item.id === approving)
              if (!application) return null
              return (
                <section className="panel admin-panel admin-form" aria-label="Одобрение заявки">
                  <h2>Одобрение: {application.name} · {application.roleLabel}</h2>
                  {application.role === 'patient' && (
                    <div className="admin-form__grid">
                      <label className="admin-field">
                        <span>Лечащий врач</span>
                        <select className="field__control field__control--sm" value={form.doctorId}
                          onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
                          {apps.doctors.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>{doctor.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field">
                        <span>Дата рождения</span>
                        <input type="date" className="field__control field__control--sm" value={form.birthDate}
                          onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
                      </label>
                      <label className="admin-field">
                        <span>Пол</span>
                        <select className="field__control field__control--sm" value={form.sex}
                          onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                          {apps.sexes.map((sex) => <option key={sex.id} value={sex.id}>{sex.label}</option>)}
                        </select>
                      </label>
                      <label className="admin-field">
                        <span>Нозология</span>
                        <select className="field__control field__control--sm" value={form.nosology}
                          onChange={(e) => setForm({ ...form, nosology: e.target.value })}>
                          {apps.nosologies.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="admin-field admin-field--wide">
                        <span>Диагноз</span>
                        <input className="field__control field__control--sm" value={form.diagnosis}
                          onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
                      </label>
                      <label className="admin-field">
                        <span>Код МКБ</span>
                        <input className="field__control field__control--sm" value={form.icdCode}
                          onChange={(e) => setForm({ ...form, icdCode: e.target.value })} />
                      </label>
                    </div>
                  )}
                  {application.role === 'relative' && (
                    <label className="admin-field">
                      <span>К какому пациенту открыть доступ</span>
                      <select className="field__control field__control--sm" value={form.patientId}
                        onChange={(e) => setForm({ ...form, patientId: e.target.value })}>
                        {apps.patients.map((patient) => (
                          <option key={patient.id} value={patient.id}>{patient.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {application.role === 'doctor' && (
                    <div className="admin-form__grid">
                      <label className="admin-field">
                        <span>Специальность</span>
                        <input className="field__control field__control--sm" value={form.specialty}
                          onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
                      </label>
                      <label className="admin-field">
                        <span>Клиника</span>
                        <input className="field__control field__control--sm" value={form.clinic}
                          onChange={(e) => setForm({ ...form, clinic: e.target.value })} />
                      </label>
                    </div>
                  )}
                  <div className="admin-actions">
                    <Button variant="primary" size="sm" disabled={!formValid(application) || busy}
                      onClick={() => submitDecision({ type: 'approve', id: application.id })}>
                      Подтвердить
                    </Button>
                    <Button size="sm" onClick={() => setApproving(null)}>Отмена</Button>
                  </div>
                  <p className="admin-sub">Учётная запись создаётся, временный пароль приходит SMS.</p>
                </section>
              )
            })()}
          </>
        )}

        {tab === 'users' && (
          <>
            <div className="admin-filters">
              <label>
                <span className="vh">Поиск пользователя</span>
                <input
                  type="search"
                  className="field__control field__control--sm"
                  placeholder="ФИО, телефон или e-mail"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                <span className="vh">Роль</span>
                <select className="field__control field__control--sm" value={role}
                  onChange={(e) => setRole(e.target.value)}>
                  {ROLE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              {users && <span className="admin-sub">Показано {users.length}</span>}
            </div>
            {resetInfo && (
              <section className="panel admin-reset" role="status">
                <div className="admin-reset__text">
                  <span className="admin-reset__title">Новый временный пароль</span>
                  <span>
                    Логин: {resetInfo.login} · пароль:{' '}
                    <code className="num admin-reset__code">{resetInfo.password}</code>
                  </span>
                  <span className="admin-sub">
                    Показывается один раз. Пароль также отправлен SMS; после входа пользователь может сменить его.
                  </span>
                </div>
                <div className="admin-actions">
                  <Button size="sm" onClick={() => navigator.clipboard?.writeText(resetInfo.password)}>
                    Скопировать
                  </Button>
                  <Button size="sm" onClick={() => setResetInfo(null)}>Скрыть</Button>
                </div>
              </section>
            )}
            <section className="panel admin-panel" aria-label="Пользователи">
              <div className="admin-scroll">
                <table className="data-table admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Пользователь</th>
                      <th scope="col">Роль</th>
                      <th scope="col">Статус</th>
                      <th scope="col">Последний вход</th>
                      <th scope="col">Доступ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users ?? []).map((user) => (
                      <tr key={user.id}>
                        <td>
                          <span className="admin-name">{user.name}</span>
                          <span className="admin-sub">{user.contact}</span>
                        </td>
                        <td>{user.roleLabel}</td>
                        <td className={user.blocked ? 'admin-bad' : undefined}>
                          {user.blocked ? 'Заблокирован' : 'Активен'}
                        </td>
                        <td className="num admin-sub">{user.lastLogin ? formatDayTime(user.lastLogin) : '—'}</td>
                        <td>
                          <div className="admin-user-actions">
                            <Button size="sm" disabled={user.isSelf} onClick={() => toggleBlock(user)}>
                              {user.blocked ? 'Разблокировать' : 'Заблокировать'}
                            </Button>
                            <Button size="sm" disabled={user.isSelf} onClick={() => resetPassword(user)}>
                              Сбросить пароль
                            </Button>
                            <Button variant="danger" size="sm" disabled={user.isSelf} onClick={() => removeUser(user)}>
                              Удалить
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users && users.length === 0 && <p className="admin-empty">Пользователи не найдены.</p>}
              </div>
            </section>
          </>
        )}

        {tab === 'analytics' && <Analytics />}

        {tab === 'audit' && (
          <>
            <div className="admin-filters">
              <label>
                <span className="vh">Тип события</span>
                <select className="field__control field__control--sm" value={auditType}
                  onChange={(e) => setAuditType(e.target.value)}>
                  {(audit?.groups ?? [{ id: 'all', label: 'Все события' }]).map((group) => (
                    <option key={group.id} value={group.id}>{group.label}</option>
                  ))}
                </select>
              </label>
              <span className="admin-sub">Журнал хранится 3 года; изменить или удалить записи нельзя</span>
            </div>
            <section className="panel admin-panel" aria-label="Журнал аудита">
              <div className="admin-scroll">
                <table className="data-table admin-table admin-table--audit">
                  <thead>
                    <tr>
                      <th scope="col">Время</th>
                      <th scope="col">Кто</th>
                      <th scope="col">Действие</th>
                      <th scope="col">Объект</th>
                      <th scope="col">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit?.events ?? []).map((event) => (
                      <tr key={event.id}>
                        <td className="num admin-nowrap">{formatDayTime(event.createdAt)}</td>
                        <td>{event.who}</td>
                        <td className={event.security ? 'admin-bad' : undefined}>{event.action}</td>
                        <td className="admin-sub">{event.object || '—'}</td>
                        <td className="num admin-sub">{event.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit && audit.events.length === 0 && <p className="admin-empty">Событий нет.</p>}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default Admin
