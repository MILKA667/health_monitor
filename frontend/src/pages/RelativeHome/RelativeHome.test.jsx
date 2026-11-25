import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RelativeHome from '.'

vi.mock('../../api/relative', () => ({ getRelativeHome: vi.fn(), setRelativePush: vi.fn() }))
vi.mock('../../api/auth', () => ({ logout: vi.fn() }))
const api = await import('../../api/relative')

const CREATED = '2026-11-25T20:13:00+03:00'

const DATA = {
  viewer: { name: 'Ковалёв Д. С.' },
  patient: {
    name: 'Ковалёва Нина Петровна', relation: 'сын', diagnosis: 'Сахарный диабет 2 типа',
    phoneMasked: '+7 ••• ••• 01 02', phone: '79000000102',
  },
  alert: {
    value: '2,9', unit: 'ммоль/л', kind: 'glucose', rule: 'ниже критического порога 3,9',
    createdAt: CREATED, acceptedAt: null, acceptedBy: null, escalateAt: '2026-11-25T20:28:00+03:00',
    relativeSmsAt: '2026-11-25T20:14:00+03:00', escalated: false,
  },
  measurements: [
    { id: 1, value: '2,9', unit: 'ммоль/л', level: 'crit', deviation: '−1,0 ниже 3,9', measuredAt: CREATED },
    { id: 2, value: '4,6', unit: 'ммоль/л', level: 'ok', deviation: null, measuredAt: CREATED },
  ],
  notifications: { push: true, sms: true },
  consentAt: '2026-08-27T10:00:00+03:00',
  doctor: { name: 'Смирнова Е. А.' },
}

function renderHome() {
  render(
    <MemoryRouter>
      <RelativeHome />
    </MemoryRouter>,
  )
}

describe('RelativeHome', () => {
  beforeEach(() => {
    api.getRelativeHome.mockReset()
    api.setRelativePush.mockReset()
    api.getRelativeHome.mockResolvedValue(DATA)
  })

  it('показывает алерт близкого и хронологию реакции', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    expect(screen.getByText('сын · сахарный диабет 2 типа')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Сахар ниже допустимого' })).toBeInTheDocument()
    expect(screen.getAllByText('2,9').length).toBeGreaterThan(0)
    expect(screen.getByText('Врач получил уведомление')).toBeInTheDocument()
    expect(screen.getByText('Вам отправлено сообщение в Telegram')).toBeInTheDocument()
    expect(screen.getByText('Ожидается реакция врача')).toBeInTheDocument()
    expect(screen.getByText('−1,0 ниже 3,9')).toBeInTheDocument()
    expect(screen.getByText('в пределах цели')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79000000102')
    expect(screen.getByRole('link', { name: 'Скорая — 103' })).toHaveAttribute('href', 'tel:103')
    expect(screen.getByText(/переписка с врачом вам недоступна/)).toBeInTheDocument()
  })

  it('выключает push-уведомления', async () => {
    api.setRelativePush.mockResolvedValue({ push: false })
    renderHome()

    const checkbox = await screen.findByRole('checkbox', { name: 'Push при критичном значении' })
    await userEvent.click(checkbox)
    expect(api.setRelativePush).toHaveBeenCalledWith(false)
    expect(checkbox).not.toBeChecked()
  })
})
