import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./api/auth', () => ({ logout: vi.fn() }))
vi.mock('./api/doctor', () => ({
  getDoctorHeader: vi.fn(),
  getConversations: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  getReports: vi.fn(),
  getReport: vi.fn(),
}))
const api = await import('./api/doctor')

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

  it('не пускает неизвестный адрес врача — ведёт на вход', async () => {
    renderApp('/doctor/unknown')
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  })
})
