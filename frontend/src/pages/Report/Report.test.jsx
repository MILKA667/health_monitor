import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Report from '.'

vi.mock('../../api/doctor', () => ({ getReport: vi.fn() }))
const api = await import('../../api/doctor')

const NOW = '2026-11-25T19:44:00+03:00'

const REPORT = {
  id: 1,
  kind: 'patient',
  title: 'По пациенту · Ковалёва Н. П.',
  days: 14,
  periodText: '12.11–25.11.2026',
  createdAt: NOW,
  sections: [
    { id: 'dynamics', label: 'Динамика показателей' },
    { id: 'alerts', label: 'Алерты и время реакции' },
  ],
  doctor: { name: 'Смирнова Е. А.', specialty: 'эндокринолог', clinic: 'Городская поликлиника № 3' },
  patient: {
    name: 'Ковалёва Нина Петровна',
    sex: 'жен.',
    age: 67,
    diagnosis: 'Сахарный диабет 2 типа',
    icdCode: 'E11.9',
    policyTail: '4821',
    dynamics: {
      stats: [
        { label: 'Среднее', value: '3,7' },
        { label: 'Мин.', value: '2,9', tone: 'crit' },
      ],
      thresholds: [{ label: 'Цель', value: '4,4–10,0 ммоль/л' }],
      measurements: [
        { measuredAt: NOW, value: '2,9', unit: 'ммоль/л', level: 'crit', context: 'натощак', source: 'глюкометр' },
      ],
    },
    alerts: [
      { createdAt: NOW, level: 'crit', value: '2,9', unit: 'ммоль/л', rule: 'ниже порога 3,9',
        acceptedBy: null, responseMinutes: null, escalated: true },
    ],
  },
}

function renderReport() {
  render(
    <MemoryRouter initialEntries={['/doctor/reports/1']}>
      <Routes>
        <Route path="/doctor/reports/:reportId" element={<Report />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Report', () => {
  beforeEach(() => {
    api.getReport.mockReset()
    api.getReport.mockResolvedValue(REPORT)
  })

  it('показывает шапку, разделы и печать', async () => {
    renderReport()
    expect(await screen.findByRole('heading', { name: 'По пациенту · Ковалёва Н. П.' })).toBeInTheDocument()
    expect(api.getReport).toHaveBeenCalledWith('1')
    expect(screen.getByText('Городская поликлиника № 3')).toBeInTheDocument()
    expect(screen.getByText('жен., 67 лет')).toBeInTheDocument()
    expect(screen.getByText('натощак')).toBeInTheDocument()
    expect(screen.getByText('ожидает')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← К отчётам' })).toHaveAttribute('href', '/doctor/reports')
    expect(screen.getByRole('button', { name: 'Печать / Сохранить в PDF' })).toBeInTheDocument()
  })
})
