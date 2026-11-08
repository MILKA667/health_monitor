import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import Login from '.'

vi.mock('../../api/auth', () => ({ login: vi.fn() }))
const { login } = await import('../../api/auth')

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/doctor" element={<p>Рабочий список</p>} />
        <Route path="/welcome" element={<p>Первый вход</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillAndSubmit(user) {
  await user.type(screen.getByLabelText('Телефон или e-mail'), 'doctor@demo.ru')
  await user.type(screen.getByLabelText('Пароль'), 'demo1234')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
}

describe('Login', () => {
  beforeEach(() => {
    login.mockReset()
  })

  it('кнопка «Войти» неактивна при пустых полях', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
  })

  it('ведёт на домашнюю страницу роли', async () => {
    login.mockResolvedValue({ role: 'doctor', mustChangePassword: false })
    renderLogin()
    await fillAndSubmit(userEvent.setup())
    expect(login).toHaveBeenCalledWith('doctor@demo.ru', 'demo1234')
    expect(await screen.findByText('Рабочий список')).toBeInTheDocument()
  })

  it('при временном пароле ведёт на первый вход', async () => {
    login.mockResolvedValue({ role: 'patient', mustChangePassword: true })
    renderLogin()
    await fillAndSubmit(userEvent.setup())
    expect(await screen.findByText('Первый вход')).toBeInTheDocument()
  })

  it('показывает ошибку сервера', async () => {
    login.mockRejectedValue(new ApiError('Неверный телефон, e-mail или пароль.', 401))
    renderLogin()
    await fillAndSubmit(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный телефон, e-mail или пароль.')
  })
})
