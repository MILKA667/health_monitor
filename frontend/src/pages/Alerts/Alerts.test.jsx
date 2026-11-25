import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '../../utils/format'
import Alerts from '.'

vi.mock('../../api/doctor', () => ({
  getAlerts: vi.fn(),
  acceptAlert: vi.fn(),
  undoAlert: vi.fn(),
}))
const api = await import('../../api/doctor')

const CREATED = '2026-11-25T18:56:00+03:00'

const OPEN_ALERT = {
  id: 1,
  patientId: 4,
  patientName: 'Ковалёва Нина Петровна',
  diagnosis: 'Сахарный диабет 2 типа',
  level: 'crit',
  value: '2,9',
  unit: 'ммоль/л',
  rule: 'ниже критического порога 3,9',
  createdAt: CREATED,
  relativeName: 'Ковалёв Дмитрий, сын',
  relativeSmsAt: '2026-11-25T18:57:00+03:00',
  acceptedAt: null,
  acceptedBy: null,
  escalateAt: '2026-11-25T19:11:00+03:00',
  escalated: false,
  own: true,
  canAccept: true,
  canUndo: false,
}

const CLOSED_ALERT = {
  ...OPEN_ALERT,
  id: 2,
  level: 'warn',
  value: '11,4',
  rule: 'выше цели 10,0',
  patientName: 'Лебедева Ольга Ивановна',
  diagnosis: 'Сахарный диабет 1 типа',
  relativeName: null,
  relativeSmsAt: null,
  acceptedAt: '2026-11-25T19:00:00+03:00',
  acceptedBy: 'Смирнова Е. А.',
  escalateAt: null,
  canAccept: false,
  canUndo: true,
}

const DATA = {
  counts: { open: 1, closed: 1, all: 2 },
  dutyDoctor: 'Орлов В. Н.',
  alerts: [OPEN_ALERT, CLOSED_ALERT],
}

function renderAlerts() {
  render(
    <MemoryRouter initialEntries={['/doctor/alerts']}>
      <Routes>
        <Route path="/doctor/alerts" element={<Alerts />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Alerts', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getAlerts.mockResolvedValue(DATA)
  })

  it('показывает счётчики вкладок и открытые алерты', async () => {
    renderAlerts()
    expect(await screen.findByRole('tab', { name: 'Открытые · 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Закрытые · 1' })).toBeInTheDocument()

    const row = screen.getByText('Ковалёва Нина Петровна').closest('.alerts__row')
    expect(within(row).getByText('2,9')).toBeInTheDocument()
    expect(within(row).getByText('врач; сын — SMS ' + formatTime(OPEN_ALERT.relativeSmsAt))).toBeInTheDocument()
    expect(within(row).getByText('ожидает · в ' + formatTime(OPEN_ALERT.escalateAt))).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Принять' })).toBeInTheDocument()
    expect(screen.queryByText('Лебедева Ольга Ивановна')).not.toBeInTheDocument()
  })

  it('принимает алерт из списка', async () => {
    api.acceptAlert.mockResolvedValue({ ...OPEN_ALERT, acceptedAt: CREATED, acceptedBy: 'Смирнова Е. А.' })
    api.getAlerts.mockResolvedValueOnce(DATA).mockResolvedValueOnce({
      ...DATA,
      counts: { open: 0, closed: 2, all: 2 },
      alerts: [{ ...OPEN_ALERT, acceptedAt: CREATED, acceptedBy: 'Смирнова Е. А.' }, CLOSED_ALERT],
    })
    renderAlerts()

    await userEvent.click(await screen.findByRole('button', { name: 'Принять' }))
    expect(api.acceptAlert).toHaveBeenCalledWith(1)
    expect(await screen.findByRole('tab', { name: 'Открытые · 0' })).toBeInTheDocument()
  })

  it('фильтрует закрытые по уровню', async () => {
    renderAlerts()
    await userEvent.click(await screen.findByRole('tab', { name: 'Закрытые · 1' }))
    expect(screen.getByText('Лебедева Ольга Ивановна')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Уровень'), 'crit')
    expect(screen.queryByText('Лебедева Ольга Ивановна')).not.toBeInTheDocument()
    expect(screen.getByText('Нет алертов по заданным условиям.')).toBeInTheDocument()
  })
})
