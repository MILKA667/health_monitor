import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientHome from '.'

vi.mock('../../api/patient', () => ({ getHome: vi.fn(), toggleIntake: vi.fn() }))
const api = await import('../../api/patient')

const NOW = new Date().toISOString()

const HOME = {
  name: 'Ковалёва Н. П.',
  kind: 'glucose',
  kindTitle: 'Глюкоза крови',
  target: '4,4–10,0 ммоль/л',
  limits: { crit_low: 3.9, warn_low: 4.4, warn_high: 10, crit_high: 13.9 },
  pefBest: null,
  last: {
    id: 4, value: '2,9', unit: 'ммоль/л', level: 'crit', deviation: '−1,0 ниже 3,9',
    context: 'Натощак', measuredAt: NOW, isToday: true,
  },
  recent: [
    { id: 3, value: '3,4', unit: 'ммоль/л', level: 'crit', deviation: '', context: 'Перед сном', measuredAt: NOW, isToday: true },
  ],
  plan: {
    done: 1,
    total: 2,
    items: [
      {
        id: 'slot:1', type: 'medication', slotId: 1, title: 'Метформин 1000 мг',
        subtitle: '1 таблетка после завтрака', time: '09:00', done: true,
      },
      {
        id: 'reminder:1', type: 'measurement', kind: 'glucose', title: 'Замер глюкозы натощак',
        subtitle: 'Данные передаст устройство', time: '10:30', done: false,
      },
    ],
  },
}

function renderHome() {
  render(
    <MemoryRouter>
      <PatientHome />
    </MemoryRouter>,
  )
}

describe('PatientHome', () => {
  beforeEach(() => {
    api.getHome.mockReset()
    api.toggleIntake.mockReset()
    api.getHome.mockResolvedValue(HOME)
  })

  it('показывает последний показатель, план и измерения', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: /^Сегодня, \d+ / })).toBeInTheDocument()
    expect(screen.getByText('2,9')).toBeInTheDocument()
    expect(screen.getByText(/ммоль\/л · −1,0 ниже 3,9/)).toBeInTheDocument()
    expect(screen.getByText(/План на сегодня/)).toHaveTextContent('· 1 из 2')
    expect(screen.getByText('Замер глюкозы натощак')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Внести показатель' })).toHaveAttribute('href', '/patient/entry')
  })

  it('отмечает приём лекарства', async () => {
    api.toggleIntake.mockResolvedValue({ done: false })
    renderHome()

    const checkbox = await screen.findByRole('checkbox', { name: /Метформин/ })
    await userEvent.click(checkbox)
    expect(api.toggleIntake).toHaveBeenCalledWith(1, false)
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText(/План на сегодня/)).toHaveTextContent('· 0 из 2')
  })
})
