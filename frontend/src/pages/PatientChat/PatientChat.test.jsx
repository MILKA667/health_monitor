import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientChat from '.'

vi.mock('../../api/patient', () => ({ getChat: vi.fn(), sendChat: vi.fn() }))
const api = await import('../../api/patient')

const NOW = '2026-11-25T18:56:00+03:00'

const CHAT = {
  doctor: { name: 'Смирнова Е. А.', specialty: 'эндокринолог', hours: 'отвечает с 9:00 до 18:00' },
  alert: { createdAt: NOW, value: '2,9', unit: 'ммоль/л', rule: 'ниже критического порога 3,9' },
  messages: [
    { id: 1, body: 'Голова кружится, руки дрожат.', createdAt: NOW, author: 'Ковалёва Нина Петровна',
      authorShort: 'Ковалёва Н. П.', mine: true },
    { id: 2, body: 'Примите 15–20 г быстрых углеводов.', createdAt: NOW, author: 'Смирнова Елена Андреевна',
      authorShort: 'Смирнова Е. А.', mine: false },
  ],
}

function renderChat() {
  render(
    <MemoryRouter>
      <PatientChat />
    </MemoryRouter>,
  )
}

describe('PatientChat', () => {
  beforeEach(() => {
    api.getChat.mockReset()
    api.sendChat.mockReset()
    api.getChat.mockResolvedValue(CHAT)
  })

  it('показывает врача, алерт и переписку', async () => {
    renderChat()
    expect(await screen.findByRole('heading', { name: 'Чат с врачом' })).toBeInTheDocument()
    expect(screen.getByText('Смирнова Е. А., эндокринолог · отвечает с 9:00 до 18:00')).toBeInTheDocument()
    expect(screen.getByText(/2,9 ммоль\/л вне порога. Врач уведомлён./)).toBeInTheDocument()
    expect(screen.getByText('Вы')).toBeInTheDocument()
    expect(screen.getByText('Смирнова Е. А.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '103' })).toHaveAttribute('href', 'tel:103')
  })

  it('отправляет сообщение', async () => {
    api.sendChat.mockResolvedValue({
      id: 3, body: 'Спасибо, стало лучше.', createdAt: NOW, author: 'Ковалёва Нина Петровна',
      authorShort: 'Ковалёва Н. П.', mine: true,
    })
    renderChat()

    const field = await screen.findByPlaceholderText('Сообщение врачу')
    await userEvent.type(field, 'Спасибо, стало лучше.')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(api.sendChat).toHaveBeenCalledWith('Спасибо, стало лучше.')
    expect(await screen.findByText('Спасибо, стало лучше.')).toBeInTheDocument()
    expect(field).toHaveValue('')
  })
})
