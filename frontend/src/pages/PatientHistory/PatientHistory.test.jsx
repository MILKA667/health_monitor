import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientHistory from '.'

vi.mock('../../api/patient', () => ({ getHistory: vi.fn() }))
const api = await import('../../api/patient')

const NOW = '2026-11-25T18:56:00+03:00'

const DATA = {
  days: 14,
  kind: 'glucose',
  kindTitle: 'Глюкоза крови',
  target: '4,4–10,0 ммоль/л',
  chart: {
    title: 'Глюкоза крови, ммоль/л',
    series: [{ id: 'glucose', label: null, points: [{ date: NOW, value: 2.9, level: 'crit' }] }],
    domain: [2, 10],
    yTicks: [{ value: 2, label: '2,0' }, { value: 10, label: '10,0' }],
    bands: [{ from: 4.4, to: 10 }],
    guides: [{ value: 3.9, tone: 'crit', label: '3,9' }],
    firstDate: NOW,
    lastDate: NOW,
  },
  stats: [
    { label: 'Среднее', value: '3,7' },
    { label: 'Мин.', value: '2,9', tone: 'crit' },
    { label: 'Макс.', value: '4,6' },
    { label: 'Вне цели', value: '3 из 4' },
  ],
  measurements: [
    { id: 4, value: '2,9', unit: 'ммоль/л', level: 'crit', context: 'Натощак', measuredAt: NOW },
    { id: 1, value: '4,6', unit: 'ммоль/л', level: 'ok', context: 'Натощак', measuredAt: NOW },
  ],
}

function renderHistory() {
  render(
    <MemoryRouter>
      <PatientHistory />
    </MemoryRouter>,
  )
}

describe('PatientHistory', () => {
  beforeEach(() => {
    api.getHistory.mockReset()
    api.getHistory.mockResolvedValue(DATA)
  })

  it('показывает график, статистику и измерения', async () => {
    renderHistory()
    expect(await screen.findByRole('heading', { name: 'История измерений' })).toBeInTheDocument()
    expect(api.getHistory).toHaveBeenCalledWith(14)
    expect(screen.getByText('3,7')).toBeInTheDocument()
    expect(screen.getByText('3 из 4')).toBeInTheDocument()
    expect(screen.getAllByText('2,9').length).toBeGreaterThan(0)
    expect(screen.getByText('Серая полоса — цель, пунктир — критический порог. Красные точки — значения вне цели.'))
      .toBeInTheDocument()
  })

  it('переключает период', async () => {
    renderHistory()
    await screen.findByRole('heading', { name: 'История измерений' })
    await userEvent.selectOptions(screen.getByLabelText('Период'), '7')
    expect(api.getHistory).toHaveBeenLastCalledWith(7)
  })
})
