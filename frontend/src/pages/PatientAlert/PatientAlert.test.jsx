import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientAlert from '.'

vi.mock('../../api/patient', () => ({ getLatestAlert: vi.fn() }))
const api = await import('../../api/patient')

const NOW = '2026-11-25T19:49:00+03:00'

const ALERT = {
  value: '2,9',
  unit: 'ммоль/л',
  kind: 'glucose',
  level: 'crit',
  rule: 'ниже критического порога 3,9',
  threshold: 'ниже 3,9 или выше 13,9 ммоль/л',
  createdAt: NOW,
  escalateAt: '2026-11-25T20:04:00+03:00',
  escalated: false,
  doctor: { name: 'Смирнова Е. А.' },
  relative: { label: 'Сын, Ковалёв Д.' },
  relativeSmsAt: NOW,
  memo: {
    text: 'Выпейте стакан сладкого сока или примите 4 таблетки глюкозы.',
    createdAt: '2026-11-25T18:10:00+03:00',
    author: 'Смирнова Е. А.',
  },
}

function renderAlert() {
  render(
    <MemoryRouter>
      <PatientAlert />
    </MemoryRouter>,
  )
}

describe('PatientAlert', () => {
  beforeEach(() => {
    api.getLatestAlert.mockReset()
    api.getLatestAlert.mockResolvedValue(ALERT)
  })

  it('показывает значение, уведомления, памятку и действия', async () => {
    renderAlert()
    expect(await screen.findByRole('heading', { name: 'Сахар ниже допустимого' })).toBeInTheDocument()
    expect(screen.getByText('2,9')).toBeInTheDocument()
    expect(screen.getByText(/Критический порог — ниже 3,9 или выше 13,9 ммоль\/л/)).toBeInTheDocument()
    expect(screen.getByText('Врач Смирнова Е. А.')).toBeInTheDocument()
    expect(screen.getByText('Сын, Ковалёв Д.')).toBeInTheDocument()
    expect(screen.getByText(/Выпейте стакан сладкого сока/)).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Вызвать скорую — 103' })).toHaveAttribute('href', 'tel:103')
    expect(screen.getByRole('link', { name: 'Повторный замер' })).toHaveAttribute('href', '/patient/entry')
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/patient')
  })
})
