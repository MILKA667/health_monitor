import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientReminders from '.'

vi.mock('../../api/patient', () => ({
  getReminders: vi.fn(),
  setMedicationReminder: vi.fn(),
  setMeasurementReminder: vi.fn(),
  addMeasurementReminder: vi.fn(),
}))
const api = await import('../../api/patient')

const DATA = {
  kind: 'glucose',
  medications: [
    { id: 1, title: 'Метформин 1000 мг', subtitle: '1 таблетка после завтрака', time: '09:00', enabled: true },
    { id: 2, title: 'Метформин 1000 мг', subtitle: '1 таблетка после ужина', time: '19:00', enabled: true },
  ],
  measurements: [
    { id: 1, title: 'Замер глюкозы натощак', subtitle: 'каждый день', time: '10:30', enabled: true },
  ],
  addOptions: [{ id: 'glucose', label: 'Глюкоза крови' }],
}

function renderReminders() {
  render(
    <MemoryRouter>
      <PatientReminders />
    </MemoryRouter>,
  )
}

describe('PatientReminders', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getReminders.mockResolvedValue(DATA)
  })

  it('показывает напоминания и выключает лекарство', async () => {
    api.setMedicationReminder.mockResolvedValue({ enabled: false })
    renderReminders()

    const checkbox = await screen.findByRole('checkbox', { name: 'Выключить: Метформин 1000 мг, 09:00' })
    await userEvent.click(checkbox)
    expect(api.setMedicationReminder).toHaveBeenCalledWith(1, false)
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('Замер глюкозы натощак')).toBeInTheDocument()
  })

  it('добавляет напоминание о замере', async () => {
    api.addMeasurementReminder.mockResolvedValue({ reminder: { id: 2, time: '21:00' } })
    api.getReminders.mockResolvedValueOnce(DATA).mockResolvedValueOnce({
      ...DATA,
      measurements: [...DATA.measurements, { id: 2, title: 'Замер глюкозы натощак', subtitle: 'каждый день', time: '21:00', enabled: true }],
    })
    renderReminders()

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить напоминание о замере' }))
    await userEvent.clear(screen.getByLabelText('Время'))
    await userEvent.type(screen.getByLabelText('Время'), '21:00')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(api.addMeasurementReminder).toHaveBeenCalledWith({ kind: 'glucose', time: '21:00' })
    expect(await screen.findByText('21:00')).toBeInTheDocument()
  })

  it('выключает напоминание о замере', async () => {
    api.setMeasurementReminder.mockResolvedValue({ enabled: false })
    renderReminders()

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Выключить: Замер глюкозы натощак, 10:30' }))
    expect(api.setMeasurementReminder).toHaveBeenCalledWith(1, false)
  })
})
