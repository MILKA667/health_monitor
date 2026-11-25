import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '../../utils/format'
import Thresholds from '.'

vi.mock('../../api/doctor', () => ({
  getThresholds: vi.fn(),
  saveThresholds: vi.fn(),
}))
const api = await import('../../api/doctor')

const DATA = {
  scope: { type: 'patient', id: 4, label: 'Пациент: Ковалёва Н. П.' },
  rows: [
    {
      metric: 'glucose',
      label: 'Глюкоза крови',
      unit: 'ммоль/л',
      values: { crit_low: '3,9', warn_low: '4,4', warn_high: '10,0', crit_high: '13,9' },
    },
    {
      metric: 'bp_sys',
      label: 'Давление, верхнее',
      unit: 'мм рт. ст.',
      values: { crit_low: '90', warn_low: '100', warn_high: '140', crit_high: '160' },
    },
    {
      metric: 'bp_dia',
      label: 'Давление, нижнее',
      unit: 'мм рт. ст.',
      values: { crit_low: null, warn_low: null, warn_high: '90', crit_high: '100' },
    },
    {
      metric: 'pef',
      label: 'Пиковая скорость выдоха',
      unit: '% от лучшего',
      values: { crit_low: '50', warn_low: '80', warn_high: null, crit_high: null },
    },
  ],
  settings: { escalationMinutes: 15, smsRelative: true, noDataAlert: true },
  scopes: {
    patients: [{ type: 'patient', id: 4, label: 'Пациент: Ковалёва Н. П.' }],
    nosologies: [{ type: 'nosology', id: 'diabetes', label: 'Шаблон: сахарный диабет' }],
  },
}

function renderThresholds() {
  render(
    <MemoryRouter>
      <Thresholds />
    </MemoryRouter>,
  )
}

describe('Thresholds', () => {
  beforeEach(() => {
    api.getThresholds.mockReset()
    api.saveThresholds.mockReset()
    api.getThresholds.mockResolvedValue(DATA)
  })

  it('показывает пороги и цель', async () => {
    renderThresholds()
    expect(await screen.findByLabelText('Глюкоза крови: критично ниже')).toHaveValue('3,9')
    expect(screen.getByLabelText('Давление, нижнее: критично ниже')).toHaveValue('')
    expect(screen.getByText('цель от 4,4 до 10,0')).toBeInTheDocument()
    expect(screen.getByText('Изменения применятся к новым измерениям')).toBeInTheDocument()
  })

  it('блокирует сохранение, если пороги не возрастают', async () => {
    renderThresholds()
    const input = await screen.findByLabelText('Глюкоза крови: критично ниже')
    await userEvent.clear(input)
    await userEvent.type(input, '15')

    expect(screen.getByText('Пороги должны возрастать слева направо')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  it('сохраняет пороги и настройки', async () => {
    const savedAt = '2026-11-25T19:30:00+03:00'
    api.saveThresholds.mockResolvedValue({ ...DATA, savedAt })
    renderThresholds()

    await screen.findByLabelText('Глюкоза крови: критично ниже')
    await userEvent.selectOptions(screen.getByLabelText('Передать дежурному врачу без реакции через'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(api.saveThresholds).toHaveBeenCalledWith(expect.objectContaining({
      scope: DATA.scope,
      settings: { escalationMinutes: 10, smsRelative: true, noDataAlert: true },
    }))
    expect(api.saveThresholds.mock.calls[0][0].rows[0]).toEqual({
      metric: 'glucose', critLow: '3,9', warnLow: '4,4', warnHigh: '10,0', critHigh: '13,9',
    })
    expect(await screen.findByText(`Сохранено в ${formatTime(savedAt)} · записано в журнал аудита`)).toBeInTheDocument()
  })

  it('загружает шаблон нозологии при смене области', async () => {
    renderThresholds()
    await screen.findByLabelText('Глюкоза крови: критично ниже')

    await userEvent.selectOptions(screen.getByLabelText('Применяется к'), 'nosology:diabetes')
    expect(api.getThresholds).toHaveBeenLastCalledWith({ type: 'nosology', id: 'diabetes' })
  })
})
