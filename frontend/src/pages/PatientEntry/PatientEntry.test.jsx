import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientEntry from '.'

vi.mock('../../api/patient', () => ({ getHome: vi.fn(), addMeasurement: vi.fn() }))
const api = await import('../../api/patient')

const HOME = {
  kind: 'glucose',
  kindTitle: 'Глюкоза крови',
  target: '4,4–10,0 ммоль/л',
  limits: { crit_low: 3.9, warn_low: 4.4, warn_high: 10, crit_high: 13.9 },
  pefBest: null,
}

function renderEntry() {
  render(
    <MemoryRouter initialEntries={['/patient/entry']}>
      <Routes>
        <Route path="/patient/entry" element={<PatientEntry />} />
        <Route path="/patient" element={<p>Главная</p>} />
        <Route path="/patient/alert" element={<p>Экран алерта</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PatientEntry', () => {
  beforeEach(() => {
    api.getHome.mockReset()
    api.addMeasurement.mockReset()
    api.getHome.mockResolvedValue(HOME)
  })

  it('предупреждает о критическом значении и сохраняет замер', async () => {
    api.addMeasurement.mockResolvedValue({ measurement: { id: 1 }, alert: { id: 1 } })
    renderEntry()

    await userEvent.type(await screen.findByLabelText(/Значение/), '2,9')
    expect(screen.getByRole('status')).toHaveTextContent('Вне критического порога')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(api.addMeasurement).toHaveBeenCalledWith({
      kind: 'glucose', value: '2,9', value2: undefined, context: 'fast', wellbeing: [],
    })
    expect(await screen.findByText('Экран алерта')).toBeInTheDocument()
  })

  it('не даёт сохранить невозможное значение', async () => {
    renderEntry()
    await userEvent.type(await screen.findByLabelText(/Значение/), '50')

    expect(screen.getByRole('status')).toHaveTextContent('Допустимо от 1 до 35')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(api.addMeasurement).not.toHaveBeenCalled()
  })

  it('без алерта возвращает на главную', async () => {
    api.addMeasurement.mockResolvedValue({ measurement: { id: 2 }, alert: null })
    renderEntry()

    await userEvent.type(await screen.findByLabelText(/Значение/), '6,2')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Главная')).toBeInTheDocument()
  })
})
