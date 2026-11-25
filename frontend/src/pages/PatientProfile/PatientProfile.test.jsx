import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import PatientProfile from '.'

vi.mock('../../api/patient', () => ({ getProfile: vi.fn(), updateProfile: vi.fn() }))
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
    api.getProfile.mockResolvedValue(PROFILE)
  })

  it('показывает врача, близкого, устройства и согласия', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'Ковалёва Нина Петровна' })).toBeInTheDocument()
    expect(screen.getByText('Смирнова Е. А., эндокринолог')).toBeInTheDocument()
    expect(screen.getByText('Ковалёв Дмитрий, сын')).toBeInTheDocument()
    expect(screen.getByText('глюкометр подключён')).toBeInTheDocument()
    expect(screen.getAllByText('подписано 27.08.2026')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Написать' })).toHaveAttribute('href', '/patient/chat')
    expect(screen.getByRole('link', { name: 'Управлять' })).toHaveAttribute('href', '/patient/devices')
    expect(screen.getByRole('link', { name: 'Сменить' })).toHaveAttribute('href', '/patient/password')
  })

  it('выключает канал Telegram', async () => {
    api.updateProfile.mockResolvedValue({ ...PROFILE, channels: { push: true, sms: false } })
    renderProfile()

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Telegram' }))
    expect(api.updateProfile).toHaveBeenCalledWith({ sms: false })
    expect(screen.getByRole('checkbox', { name: 'Telegram' })).not.toBeChecked()
  })

  it('возвращает переключатель и показывает ошибку, если сервер отклонил', async () => {
    api.updateProfile.mockRejectedValue(new ApiError('Выберите хотя бы один способ, иначе напоминания не придут.', 400))
    renderProfile()

    const sms = await screen.findByRole('checkbox', { name: 'Telegram' })
    await userEvent.click(sms)
    expect(await screen.findByRole('alert')).toHaveTextContent('Выберите хотя бы один способ')
    expect(sms).toBeChecked()
  })
})
