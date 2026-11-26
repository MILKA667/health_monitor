import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from '.'

vi.mock('../../api/admin', () => ({
  getApplications: vi.fn(),
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
  revertApplication: vi.fn(),
  getUsers: vi.fn(),
  setUserBlocked: vi.fn(),
  resetUserPassword: vi.fn(),
  deleteUser: vi.fn(),
  getAudit: vi.fn(),
  getAnalytics: vi.fn(),
}))
vi.mock('../../api/auth', () => ({ getMe: vi.fn(), logout: vi.fn() }))
const api = await import('../../api/admin')
const auth = await import('../../api/auth')

const APPS = {
  applications: [
    {
      id: 3, role: 'patient', roleLabel: 'Пациент', name: 'Тихонов Глеб Аркадьевич',
      phoneMasked: '+7 ••• ••• 07 77', email: 'g.tikhonov@mail.ru', extra: '',
      createdAt: '2026-11-25T12:00:00+03:00', decidedAt: null, status: 'pending', consentGiven: true,
    },
    {
      id: 2, role: 'relative', roleLabel: 'Родственник', name: 'Савельева Марина Викторовна',
      phoneMasked: '+7 ••• ••• 01 03', email: null, extra: 'Савельев Игорь Андреевич',
      createdAt: '2026-11-25T11:00:00+03:00', decidedAt: null, status: 'pending', consentGiven: false,
    },
    {
      id: 1, role: 'doctor', roleLabel: 'Врач', name: 'Гусев Роман Ильич',
      phoneMasked: '+7 ••• ••• 05 01', email: 'r.gusev@clinic.ru', extra: 'пульмонолог',
      createdAt: '2026-11-24T10:00:00+03:00', decidedAt: '2026-11-24T11:00:00+03:00', status: 'approved',
      consentGiven: true,
    },
  ],
  doctors: [{ id: 2, label: 'Смирнова Е. А.' }],
  patients: [{ id: 4, label: 'Ковалёва Н. П.' }],
  roles: [{ id: 'patient', label: 'Пациент' }],
  nosologies: [{ id: 'diabetes', label: 'Сахарный диабет' }],
  sexes: [{ id: 'м', label: 'мужской' }],
}

const USERS = {
  users: [
    { id: 4, name: 'Ковалёва Нина Петровна', role: 'patient', roleLabel: 'Пациент',
      contact: '+7 ••• ••• 01 02', blocked: false, isSelf: false, lastLogin: '2026-11-25T10:00:00+03:00' },
    { id: 1, name: 'Администратор клиники', role: 'admin', roleLabel: 'Администратор',
      contact: 'admin@demo.ru', blocked: false, isSelf: true, lastLogin: null },
  ],
}

const AUDIT = {
  groups: [
    { id: 'all', label: 'Все события' },
    { id: 'security', label: 'Безопасность' },
  ],
  events: [
    { id: 1, createdAt: '2026-11-25T10:00:00+03:00', who: 'Система', action: 'Неудачная попытка входа',
      object: null, ip: '10.0.0.1', security: true },
  ],
}

const ANALYTICS = {
  period: { days: 30 },
  users: { total: 11, byRole: { doctor: 1, patient: 9, relative: 1 } },
  engagement: {
    dau: 4, wau: 9, mau: 11, stickiness: 0.36, returning: 0.72, newUsers: 2,
    retention: { d1: 0.5, d7: 0.3, d30: null },
    daily: [
      { date: '2026-11-01', active: 3, newUsers: 1, measurements: 5 },
      { date: '2026-11-02', active: 5, newUsers: 1, measurements: 7 },
    ],
  },
  funnel: {
    submitted: 10, approved: 6, loggedIn: 4, measured: 3,
    rates: { approved: 0.6, loggedIn: 0.67, measured: 0.75 },
  },
  alerts: {
    total: 12, crit: 3, warn: 8, nodata: 1, accepted: 9, acceptanceRate: 0.75,
    within15Rate: 0.42, medianMinutes: 7.5,
    daily: [
      { date: '2026-11-01', created: 2, accepted: 1 },
      { date: '2026-11-02', created: 1, accepted: 2 },
    ],
  },
  clinical: {
    measurements: 40, byKind: { glucose: 20, bp: 15, pef: 5 },
    activePatients: 9, withoutData: 1, adherence: 0.8,
  },
  quality: {
    nps: 25.0, npsResponses: 4, promoters: 2, detractors: 1,
    csat: 4.5, csatResponses: 4, csatSatisfied: 0.75,
    ces: 4.2, cesResponses: 4, responses: 12,
  },
  monetization: null,
}

function renderAdmin() {
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>,
  )
}

describe('Admin', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    Object.values(auth).forEach((fn) => fn.mockReset())
    auth.getMe.mockResolvedValue({ id: 1, role: 'admin', name: 'Администратор клиники', shortName: 'Администратор К.', mustChangePassword: false })
    api.getApplications.mockResolvedValue(APPS)
    api.getUsers.mockResolvedValue(USERS)
    api.getAudit.mockResolvedValue(AUDIT)
  })

  it('показывает заявки и блокирует одобрение без согласий', async () => {
    renderAdmin()
    expect(await screen.findByRole('tab', { name: 'Заявки · 2' })).toBeInTheDocument()
    const row = screen.getByText('Савельева Марина Викторовна').closest('tr')
    expect(within(row).getByText('согласия не получены · Савельев Игорь Андреевич')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Одобрить' })).toBeDisabled()
    expect(screen.getByText(/Одобрено/)).toBeInTheDocument()
  })

  it('одобряет заявку пациента с картой', async () => {
    api.approveApplication.mockResolvedValue({ ok: true, userId: 20 })
    renderAdmin()

    const row = (await screen.findByText('Тихонов Глеб Аркадьевич')).closest('tr')
    await userEvent.click(within(row).getByRole('button', { name: 'Одобрить' }))

    await userEvent.type(screen.getByLabelText('Дата рождения'), '1980-05-12')
    await userEvent.type(screen.getByLabelText('Диагноз'), 'Сахарный диабет 2 типа')
    await userEvent.type(screen.getByLabelText('Код МКБ'), 'E11.9')
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))

    expect(api.approveApplication).toHaveBeenCalledWith(3, expect.objectContaining({
      doctorId: 2, birthDate: '1980-05-12', sex: 'м', nosology: 'diabetes',
      diagnosis: 'Сахарный диабет 2 типа', icdCode: 'E11.9',
    }))
  })

  it('ищет пользователей и блокирует доступ', async () => {
    api.setUserBlocked.mockResolvedValue({ blocked: true })
    renderAdmin()

    await userEvent.click(await screen.findByRole('tab', { name: 'Пользователи' }))
    expect(await screen.findByText('Ковалёва Нина Петровна')).toBeInTheDocument()
    const row = screen.getByText('Ковалёва Нина Петровна').closest('tr')
    const block = within(row).getByRole('button', { name: 'Заблокировать' })
    expect(block).toBeEnabled()

    await userEvent.click(block)
    expect(api.setUserBlocked).toHaveBeenCalledWith(4, true)

    await userEvent.type(screen.getByPlaceholderText('ФИО, телефон или e-mail'), 'Кова')
    expect(api.getUsers).toHaveBeenLastCalledWith({ search: 'Кова', role: 'all' })
  })

  it('фильтрует журнал аудита', async () => {
    renderAdmin()
    await userEvent.click(await screen.findByRole('tab', { name: 'Журнал аудита' }))
    expect(await screen.findByText('Неудачная попытка входа')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Тип события'), 'security')
    expect(api.getAudit).toHaveBeenLastCalledWith('security')
  })

  it('сбрасывает пароль и показывает новый один раз', async () => {
    api.resetUserPassword.mockResolvedValue({ password: 'Abc1234567', login: '+7 ••• ••• 01 02' })
    renderAdmin()

    await userEvent.click(await screen.findByRole('tab', { name: 'Пользователи' }))
    const row = (await screen.findByText('Ковалёва Нина Петровна')).closest('tr')
    await userEvent.click(within(row).getByRole('button', { name: 'Сбросить пароль' }))

    expect(api.resetUserPassword).toHaveBeenCalledWith(4)
    expect(await screen.findByRole('status')).toHaveTextContent('Abc1234567')
    expect(screen.getByText(/Показывается один раз/)).toBeInTheDocument()
  })

  it('показывает дашборд метрик и меняет период', async () => {
    api.getAnalytics.mockResolvedValue(ANALYTICS)
    renderAdmin()

    await userEvent.click(await screen.findByRole('tab', { name: 'Аналитика' }))
    expect(await screen.findByText('Вовлечённость')).toBeInTheDocument()
    expect(screen.getByText('DAU')).toBeInTheDocument()
    expect(screen.getByText('Приверженность')).toBeInTheDocument()
    expect(screen.getByText('+25')).toBeInTheDocument()
    expect(screen.getByText('4,5 из 5')).toBeInTheDocument()
    expect(api.getAnalytics).toHaveBeenCalledWith(30)

    await userEvent.click(screen.getByRole('button', { name: '7 дней' }))
    expect(api.getAnalytics).toHaveBeenLastCalledWith(7)
  })

  it('удаляет аккаунт только после подтверждения', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.deleteUser.mockResolvedValue({ ok: true })
    renderAdmin()

    await userEvent.click(await screen.findByRole('tab', { name: 'Пользователи' }))
    const row = (await screen.findByText('Ковалёва Нина Петровна')).closest('tr')
    await userEvent.click(within(row).getByRole('button', { name: 'Удалить' }))

    expect(confirm).toHaveBeenCalled()
    expect(api.deleteUser).toHaveBeenCalledWith(4)
    expect(screen.queryByText('Ковалёва Нина Петровна')).not.toBeInTheDocument()
    confirm.mockRestore()
  })
})
