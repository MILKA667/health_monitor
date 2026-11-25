import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Record from '.'

vi.mock('../../api/doctor', () => ({
  acceptAlert: vi.fn(),
  undoAlert: vi.fn(),
  getRecord: vi.fn(),
  getMedications: vi.fn(),
  getMessages: vi.fn(),
  getPatientAlerts: vi.fn(),
  sendMessage: vi.fn(),
}))
const api = await import('../../api/doctor')

const NOW = '2026-11-25T18:56:00+03:00'

const ALERT = {
  id: 3,
  level: 'crit',
  rule: 'ниже критического порога 3,9',
  createdAt: NOW,
  escalateAt: '2026-11-25T19:11:00+03:00',
  escalated: false,
  acceptedAt: null,
  acceptedBy: null,
  acceptedByMe: false,
  comment: null,
  relativeSmsAt: '2026-11-25T18:57:00+03:00',
}

const RECORD = {
  id: 4,
  name: 'Ковалёва Нина Петровна',
  sex: 'жен.',
  age: 67,
  diagnosis: 'Сахарный диабет 2 типа',
  icdCode: 'E11.9',
  policyTail: '4821',
  enrolledAt: '2026-08-27',
  consentAt: '2026-08-27T10:00:00+03:00',
  device: null,
  relative: { name: 'Ковалёв Дмитрий, сын', phoneMasked: '+7 ••• ••• 01 02', smsAlerts: true },
  alert: ALERT,
  days: 14,
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
    {
      id: 4,
      value: '2,9',
      unit: 'ммоль/л',
      level: 'crit',
      deviation: '−1,0 ниже 3,9',
      context: 'натощак',
      sourceLabel: 'глюкометр',
      measuredAt: NOW,
    },
  ],
  thresholds: [
    { label: 'Критический порог', value: 'ниже 3,9 или выше 13,9 ммоль/л' },
    { label: 'Цель', value: '4,4–10,0 ммоль/л' },
  ],
  lastMeasurementAt: NOW,
}

function renderRecord() {
  render(
    <MemoryRouter initialEntries={['/doctor/patients/4']}>
      <Routes>
        <Route path="/doctor/patients/:patientId" element={<Record />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Record', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getRecord.mockResolvedValue(RECORD)
  })

  it('показывает шапку, алерт и измерения', async () => {
    renderRecord()
    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    expect(screen.getByText('жен. · 67 лет · Сахарный диабет 2 типа (E11.9)')).toBeInTheDocument()
    expect(screen.getByText('…4821')).toBeInTheDocument()
    expect(screen.getByText('подписано 27.08.2026')).toBeInTheDocument()
    expect(screen.getByText('натощак')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Принять алерт' })).toBeInTheDocument()
    expect(screen.getByText('активный критический алерт')).toBeInTheDocument()
  })

  it('принимает алерт с комментарием', async () => {
    api.acceptAlert.mockResolvedValue({
      ...ALERT,
      acceptedAt: '2026-11-25T19:00:00+03:00',
      acceptedBy: 'Смирнова Е. А.',
      acceptedByMe: true,
    })
    api.getRecord.mockResolvedValueOnce(RECORD).mockResolvedValueOnce({
      ...RECORD,
      alert: { ...ALERT, acceptedAt: '2026-11-25T19:00:00+03:00', acceptedBy: 'Смирнова Е. А.' },
    })
    renderRecord()

    await userEvent.type(await screen.findByPlaceholderText('Комментарий (необязательно)'), 'Позвонила')
    await userEvent.click(screen.getByRole('button', { name: 'Принять алерт' }))

    expect(api.acceptAlert).toHaveBeenCalledWith(3, 'Позвонила')
    expect(await screen.findByRole('button', { name: 'Отменить' })).toBeInTheDocument()
  })

  it('подгружает назначения по вкладке', async () => {
    api.getMedications.mockResolvedValue({
      days: 14,
      medications: [
        {
          id: 1,
          name: 'Метформин 1000 мг',
          schedule: '2 раза в день, после еды',
          dose: '1 таблетка после завтрака в 09:00',
          prescribedAt: '2026-10-16',
          enabled: true,
          taken: 26,
          expected: 28,
          percent: 93,
          lastTakenAt: NOW,
        },
      ],
    })
    renderRecord()

    await userEvent.click(await screen.findByRole('tab', { name: 'Назначения' }))
    expect(await screen.findByText('Метформин 1000 мг')).toBeInTheDocument()
    expect(screen.getByText('26 / 28')).toBeInTheDocument()
    expect(api.getMedications).toHaveBeenCalledWith('4')
  })

  it('переключает период графика', async () => {
    renderRecord()
    await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })

    await userEvent.click(screen.getByRole('button', { name: '7 дн.' }))
    expect(api.getRecord).toHaveBeenLastCalledWith('4', 7)
  })
})
