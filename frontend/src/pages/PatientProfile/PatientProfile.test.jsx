import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import PatientProfile from '.'

vi.mock('../../api/patient', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  getSurveys: vi.fn(),
  submitSurvey: vi.fn(),
  signConsent: vi.fn(),
}))
vi.mock('../../api/auth', () => ({ logout: vi.fn() }))
const api = await import('../../api/patient')

const NOW = '2026-08-27T10:00:00+03:00'

const PROFILE = {
  name: 'Ковалёва Нина Петровна',
  phoneMasked: '+7 ••• ••• 01 02',
  doctor: { name: 'Смирнова Е. А.', specialty: 'эндокринолог' },
  relative: { name: 'Ковалёв Дмитрий, сын', phoneMasked: '+7 ••• ••• 01 02', smsAlerts: true },
  devices: [{ id: 1, kind: 'glucometer', name: 'Глюкометр', model: '[модель]', connected: true, lastSync: NOW }],
  channels: { push: true, sms: true },
  consents: { personalData: NOW, relativeAccess: NOW },
  passwordChangedAt: NOW,
}

function renderProfile() {
  render(
    <MemoryRouter>
      <PatientProfile />
    </MemoryRouter>,
  )
}

describe('PatientProfile', () => {
  beforeEach(() => {
    api.getProfile.mockReset()
    api.updateProfile.mockReset()
    api.getSurveys.mockReset()
    api.submitSurvey.mockReset()
    api.signConsent.mockReset()
    api.getProfile.mockResolvedValue(PROFILE)
    api.getSurveys.mockResolvedValue({ responses: {} })
  })

  it('показывает врача, близкого и согласия', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    expect(screen.getByText('Смирнова Е. А., эндокринолог')).toBeInTheDocument()
    expect(screen.getByText('Ковалёв Дмитрий, сын')).toBeInTheDocument()
    expect(screen.getAllByText('подписано 27.08.2026')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Написать' })).toHaveAttribute('href', '/patient/chat')
    expect(screen.getByRole('link', { name: 'Сменить' })).toHaveAttribute('href', '/patient/password')
    expect(screen.queryByText('Устройства')).not.toBeInTheDocument()
    expect(screen.queryByText('Уведомления приходят')).not.toBeInTheDocument()
  })

  it('выключает экстренные уведомления близкого', async () => {
    api.updateProfile.mockResolvedValue({ ...PROFILE, relative: { ...PROFILE.relative, smsAlerts: false } })
    renderProfile()

    const toggle = await screen.findByRole('checkbox', { name: 'Экстренные уведомления сын' })
    await userEvent.click(toggle)
    expect(api.updateProfile).toHaveBeenCalledWith({ relativeSms: false })
    expect(toggle).not.toBeChecked()
  })

  it('открывает заглушку согласия и подписывает его', async () => {
    const unsigned = { ...PROFILE, consents: { personalData: null, relativeAccess: null } }
    api.getProfile.mockResolvedValue(unsigned)
    api.signConsent.mockResolvedValue({ ...unsigned, consents: { personalData: NOW, relativeAccess: null } })
    renderProfile()

    await userEvent.click(await screen.findByRole('button', { name: 'Подписать согласие «Обработка данных о здоровье»' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Здесь будет текст согласия. Документ появится позже.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Подписать' }))
    expect(api.signConsent).toHaveBeenCalledWith('personal_data')
    expect(await screen.findByText('подписано 27.08.2026')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('показывает ошибку, если согласие не подписалось', async () => {
    const unsigned = { ...PROFILE, consents: { personalData: null, relativeAccess: null } }
    api.getProfile.mockResolvedValue(unsigned)
    api.signConsent.mockRejectedValue(new ApiError('Не удалось подписать согласие.', 500))
    renderProfile()

    await userEvent.click(await screen.findByRole('button', { name: 'Подписать согласие «Обработка данных о здоровье»' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Подписать' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подписать согласие')
  })

  it('скрывает уже пройденные вопросы опроса', async () => {
    api.getSurveys.mockResolvedValue({
      responses: {
        nps: { score: 9, createdAt: NOW },
        csat: { score: 5, createdAt: NOW },
      },
    })
    renderProfile()

    expect(await screen.findByText('Оценка сервиса')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Насколько вероятно, что вы порекомендуете сервис?' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Насколько вы удовлетворены сервисом?' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('group', { name: 'Насколько легко пользоваться сервисом?' })).toBeInTheDocument()
  })

  it('скрывает блок опроса, когда все вопросы пройдены', async () => {
    api.getSurveys.mockResolvedValue({
      responses: {
        nps: { score: 9, createdAt: NOW },
        csat: { score: 5, createdAt: NOW },
        ces: { score: 4, createdAt: NOW },
      },
    })
    renderProfile()

    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Оценка сервиса')).not.toBeInTheDocument())
  })

  it('отправляет оценку и скрывает вопрос', async () => {
    api.submitSurvey.mockResolvedValue({ ok: true, id: 1, createdAt: NOW })
    renderProfile()

    const group = await screen.findByRole('group', { name: 'Насколько вероятно, что вы порекомендуете сервис?' })
    await userEvent.click(within(group).getByRole('button', { name: '9' }))

    expect(api.submitSurvey).toHaveBeenCalledWith({ kind: 'nps', score: 9 })
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Насколько вероятно, что вы порекомендуете сервис?' })).not.toBeInTheDocument())
    expect(screen.getByRole('group', { name: 'Насколько вы удовлетворены сервисом?' })).toBeInTheDocument()
  })

  it('показывает ошибку, если опрос не сохранился', async () => {
    api.submitSurvey.mockRejectedValue(new ApiError('Оценка должна быть от 0 до 10.', 400))
    renderProfile()

    const group = await screen.findByRole('group', { name: 'Насколько вероятно, что вы порекомендуете сервис?' })
    await userEvent.click(within(group).getByRole('button', { name: '10' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Оценка должна быть от 0 до 10')
  })
})
