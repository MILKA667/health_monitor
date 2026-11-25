import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Reports from '.'

vi.mock('../../api/doctor', () => ({
  getReports: vi.fn(),
  createReport: vi.fn(),
}))
const api = await import('../../api/doctor')

const DATA = {
  reports: [
    {
      id: 2,
      kind: 'response',
      title: 'Реакция на алерты · отделение',
      days: 30,
      sections: [{ id: 'alerts', label: 'Алерты и время реакции' }],
      createdAt: '2026-11-25T18:00:00+03:00',
      periodText: '27.10–25.11.2026',
    },
  ],
  options: {
    kinds: [
      { id: 'patient', label: 'По пациенту' },
      { id: 'group', label: 'По группе пациентов' },
      { id: 'response', label: 'Реакция на алерты' },
    ],
    periods: [14, 30, 90],
    sections: [
      { id: 'dynamics', label: 'Динамика показателей' },
      { id: 'alerts', label: 'Алерты и время реакции' },
      { id: 'meds', label: 'Приверженность назначениям' },
      { id: 'messages', label: 'Переписка с пациентом' },
    ],
    patients: [{ id: 4, label: 'Ковалёва Н. П.' }],
    nosologies: [
      { id: 'all', label: 'все нозологии' },
      { id: 'asthma', label: 'астма' },
    ],
  },
}

function renderReports() {
  render(
    <MemoryRouter initialEntries={['/doctor/reports']}>
      <Routes>
        <Route path="/doctor/reports" element={<Reports />} />
        <Route path="/doctor/reports/:reportId" element={<p>Отчёт открыт</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Reports', () => {
  beforeEach(() => {
    api.getReports.mockReset()
    api.createReport.mockReset()
    api.getReports.mockResolvedValue(DATA)
  })

  it('показывает форму и сформированные отчёты', async () => {
    renderReports()
    expect(await screen.findByRole('radio', { name: /По пациенту/ })).toBeChecked()
    expect(screen.getByLabelText('Пациент')).toHaveValue('4')
    expect(screen.getByText('Реакция на алерты · отделение')).toBeInTheDocument()

    expect(screen.getByText(/Выгрузка фиксируется в журнале аудита/)).toHaveTextContent(
      /По пациенту · Ковалёва Н\. П\., \d{2}\.\d{2}–\d{2}\.\d{2}\.\d{4} \(14 дней\): динамика показателей, алерты и время реакции, приверженность назначениям/,
    )
  })

  it('не даёт сформировать отчёт без разделов', async () => {
    renderReports()
    for (const section of ['Динамика показателей', 'Алерты и время реакции', 'Приверженность назначениям']) {
      await userEvent.click(await screen.findByRole('checkbox', { name: section }))
    }
    expect(screen.getByText(/Выберите хотя бы один раздел/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сформировать PDF' })).toBeDisabled()
  })

  it('формирует отчёт по группе и открывает печатную версию', async () => {
    api.createReport.mockResolvedValue({ ...DATA.reports[0], id: 7 })
    renderReports()

    await userEvent.click(await screen.findByRole('radio', { name: /По группе пациентов/ }))
    await userEvent.selectOptions(screen.getByLabelText('Нозология'), 'asthma')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Динамика показателей' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Приверженность назначениям' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сформировать PDF' }))

    expect(api.createReport).toHaveBeenCalledWith({
      kind: 'group', days: 14, patientId: undefined, nosology: 'asthma', sections: ['alerts'],
    })
    expect(await screen.findByText('Отчёт открыт')).toBeInTheDocument()
  })
})
