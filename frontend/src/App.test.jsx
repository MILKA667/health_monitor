import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./api/auth', () => ({ logout: vi.fn(), getMe: vi.fn() }))
vi.mock('./api/doctor', () => ({
  getDoctorHeader: vi.fn(),
  getConversations: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  getReports: vi.fn(),
  getReport: vi.fn(),
}))
vi.mock('./api/patient', () => ({
  getHome: vi.fn(),
  toggleIntake: vi.fn(),
  addMeasurement: vi.fn(),
  getLatestAlert: vi.fn(),
}))
const api = await import('./api/doctor')
const auth = await import('./api/auth')
const patient = await import('./api/patient')

function renderApp(path) {
  window.history.pushState({}, '', path)
  render(<App />)
}

describe('App: маршруты врача', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getDoctorHeader.mockResolvedValue({ name: 'Смирнова Е. А.', specialty: 'эндокринолог', openAlerts: 0 })
    api.getConversations.mockResolvedValue({ conversations: [] })
  })
  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('открывает переписку по адресу /doctor/messages', async () => {
    renderApp('/doctor/messages')
    expect(await screen.findByRole('heading', { name: 'Сообщения' })).toBeInTheDocument()
    expect(await screen.findByText('Переписок пока нет. Начните разговор из медкарты пациента.')).toBeInTheDocument()
    expect(api.getConversations).toHaveBeenCalled()
  })

  it('открывает раздел отчётов', async () => {
    api.getReports.mockResolvedValue({
      reports: [],
      options: { kinds: [{ id: 'patient', label: 'По пациенту' }], periods: [14], sections: [{ id: 'dynamics', label: 'Динамика' }],
                 patients: [], nosologies: [{ id: 'all', label: 'все нозологии' }] },
    })
    renderApp('/doctor/reports')
    expect(await screen.findByRole('heading', { name: 'Новый отчёт' })).toBeInTheDocument()
    expect(screen.getByText('Отчётов пока нет.')).toBeInTheDocument()
  })

  it('открывает главную пациента', async () => {
    auth.getMe.mockResolvedValue({
      id: 4, role: 'patient', name: 'Ковалёва Нина Петровна', shortName: 'Ковалёва Н. П.', mustChangePassword: false,
    })
    patient.getHome.mockResolvedValue({
      name: 'Ковалёва Н. П.', kind: 'glucose', kindTitle: 'Глюкоза крови', target: '4,4–10,0 ммоль/л',
      limits: { crit_low: 3.9, warn_low: 4.4, warn_high: 10, crit_high: 13.9 }, pefBest: null,
      last: null, recent: [], plan: { done: 0, total: 0, items: [] },
    })
    renderApp('/patient')
    expect(await screen.findByText('Ковалёва Н. П.')).toBeInTheDocument()
    expect(await screen.findByText(/Замеров пока нет/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Сегодня' })).toHaveAttribute('href', '/patient')
  })

  it('не пускает неизвестный адрес врача — ведёт на вход', async () => {
    renderApp('/doctor/unknown')
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })
})
