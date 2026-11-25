import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Messages from '.'

vi.mock('../../api/doctor', () => ({
  getConversations: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
}))
const api = await import('../../api/doctor')

const NOW = '2026-11-25T18:56:00+03:00'

const CONVERSATIONS = {
  conversations: [
    {
      patientId: 4,
      name: 'Ковалёва Нина Петровна',
      shortName: 'Ковалёва Н. П.',
      diagnosis: 'Сахарный диабет 2 типа',
      unread: 1,
      lastMessage: { body: 'Выпила сок. Жду.', mine: false, createdAt: NOW },
      lastMeasurement: { value: '2,9', unit: 'ммоль/л', level: 'crit', measuredAt: NOW },
      alert: {
        rule: 'ниже критического порога 3,9',
        createdAt: NOW,
        value: '2,9',
        unit: 'ммоль/л',
        relativeSmsAt: NOW,
        escalateAt: NOW,
        escalated: false,
      },
    },
  ],
}

const MESSAGES = {
  messages: [
    { id: 1, body: 'Голова кружится, руки дрожат.', createdAt: NOW, author: 'Ковалёва Нина Петровна', mine: false },
    { id: 2, body: 'Примите 15–20 г быстрых углеводов.', createdAt: NOW, author: 'Смирнова Елена Андреевна', mine: true },
  ],
}

function renderMessages() {
  render(
    <MemoryRouter>
      <Messages />
    </MemoryRouter>,
  )
}

describe('Messages', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getConversations.mockResolvedValue(CONVERSATIONS)
    api.getMessages.mockResolvedValue(MESSAGES)
  })

  it('открывает первую переписку и показывает непрочитанные', async () => {
    renderMessages()

    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    expect(screen.getByText(/непрочитанных/)).toBeInTheDocument()
    expect(screen.getByText('Выпила сок. Жду.')).toBeInTheDocument()
    expect(api.getMessages).toHaveBeenCalledWith(4)
    expect(await screen.findByText('Голова кружится, руки дрожат.')).toBeInTheDocument()
    expect(screen.getByText(/критический алерт/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть медкарту' })).toHaveAttribute('href', '/doctor/patients/4')
  })

  it('отправляет сообщение пациенту', async () => {
    api.sendMessage.mockResolvedValue({
      id: 3, body: 'Повторите замер через 15 минут.', createdAt: NOW, author: 'Смирнова Елена Андреевна', mine: true,
    })
    renderMessages()

    const field = await screen.findByPlaceholderText('Сообщение пациенту')
    await userEvent.type(field, 'Повторите замер через 15 минут.')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(api.sendMessage).toHaveBeenCalledWith(4, 'Повторите замер через 15 минут.')
    expect(await screen.findByText('Повторите замер через 15 минут.')).toBeInTheDocument()
    expect(field).toHaveValue('')
  })

  it('ищет диалог по ФИО', async () => {
    renderMessages()
    await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })

    const search = screen.getByPlaceholderText('Поиск по ФИО')
    await userEvent.type(search, 'Сидоров')
    expect(search).toHaveValue('Сидоров')
    expect(screen.getByText('Никого не нашли по этому имени.')).toBeInTheDocument()
  })
})
