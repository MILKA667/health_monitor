import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Telegram from '.'

vi.mock('../../api/telegram', () => ({
  getTelegramStatus: vi.fn(),
  createTelegramCode: vi.fn(),
  unlinkTelegram: vi.fn(),
}))
vi.mock('../../api/auth', () => ({ getMe: vi.fn() }))
const api = await import('../../api/telegram')
const auth = await import('../../api/auth')

const STATUS = {
  linked: false,
  botUsername: 'health_monitor_vyatgu_bot',
  botLink: 'https://t.me/health_monitor_vyatgu_bot',
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/telegram']}>
      <Telegram />
    </MemoryRouter>,
  )
}

describe('Telegram', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getTelegramStatus.mockResolvedValue(STATUS)
    auth.getMe.mockResolvedValue({ id: 4, role: 'patient', name: 'Ковалёва Нина Петровна',
                                   shortName: 'Ковалёва Н. П.', mustChangePassword: false })
  })

  it('выдаёт код и ссылку на бота', async () => {
    api.createTelegramCode.mockResolvedValue({
      code: '123456',
      expiresInMinutes: 10,
      botUsername: 'health_monitor_vyatgu_bot',
      deepLink: 'https://t.me/health_monitor_vyatgu_bot?start=123456',
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Уведомления в Telegram' })).toBeInTheDocument()
    expect(screen.getByText(/health_monitor_vyatgu_bot/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Получить код' }))

    expect(api.createTelegramCode).toHaveBeenCalled()
    expect(await screen.findByText('123456')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть @health_monitor_vyatgu_bot' }))
      .toHaveAttribute('href', 'https://t.me/health_monitor_vyatgu_bot?start=123456')
  })

  it('показывает статус и отвязывает', async () => {
    api.getTelegramStatus.mockResolvedValue({ ...STATUS, linked: true })
    api.unlinkTelegram.mockResolvedValue({ linked: false })
    renderPage()

    expect(await screen.findByText('Telegram привязан')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отвязать Telegram' }))
    expect(api.unlinkTelegram).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Получить код' })).toBeInTheDocument()
  })
})