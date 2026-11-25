import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import PatientPassword from '.'

vi.mock('../../api/patient', () => ({ changePassword: vi.fn() }))
const api = await import('../../api/patient')

function renderPassword() {
  render(
    <MemoryRouter>
      <PatientPassword />
    </MemoryRouter>,
  )
}

async function fillPasswords(user, { current = 'demo1234', password = 'Newpass123', repeat = password } = {}) {
  await user.type(await screen.findByLabelText('Текущий пароль'), current)
  await user.type(screen.getByLabelText('Новый пароль'), password)
  await user.type(screen.getByLabelText('Повторите пароль'), repeat)
}

describe('PatientPassword', () => {
  beforeEach(() => {
    api.changePassword.mockReset()
  })

  it('не даёт сохранить слабый пароль', async () => {
    renderPassword()
    await fillPasswords(userEvent.setup(), { password: 'short', repeat: 'short' })
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  it('показывает ошибку при неверном текущем пароле', async () => {
    api.changePassword.mockRejectedValue(new ApiError('Неверный текущий пароль.', 400))
    renderPassword()
    await fillPasswords(userEvent.setup())
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Неверный текущий пароль.')
    expect(screen.getByRole('link', { name: 'Забыли пароль?' })).toHaveAttribute('href', '/recover')
  })

  it('меняет пароль и оставляет сеансы на других устройствах', async () => {
    api.changePassword.mockResolvedValue({ ok: true, othersSignedOut: false, passwordChangedAt: '2026-11-25T19:00:00+03:00' })
    renderPassword()
    const user = userEvent.setup()
    await fillPasswords(user)
    await user.click(screen.getByRole('checkbox', { name: /Выйти на других устройствах/ }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'demo1234', password: 'Newpass123', signOutOthers: false,
    })
    expect(await screen.findByText('Пароль изменён')).toBeInTheDocument()
    expect(screen.getByText(/Другие устройства остались в системе/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Вернуться в профиль' })).toHaveAttribute('href', '/patient/profile')
  })
})
