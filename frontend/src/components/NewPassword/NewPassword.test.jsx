import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NewPassword from '.'

const noop = () => {}

describe('NewPassword', () => {
  it('показывает выполненные и невыполненные требования текстом', () => {
    render(
      <NewPassword
        password="abc"
        repeat=""
        onPasswordChange={noop}
        onRepeatChange={noop}
        rules={[{ ok: false, text: 'не короче 8 символов' }, { ok: true, text: 'без телефона' }]}
      />,
    )
    const list = screen.getByRole('list', { name: 'Требования к паролю' })
    expect(list).toHaveTextContent('не короче 8 символов — не выполнено')
    expect(list).toHaveTextContent('без телефона — выполнено')
  })

  it('сообщает о несовпадении повтора', () => {
    render(<NewPassword password="Secret123" repeat="Secret12" onPasswordChange={noop} onRepeatChange={noop} rules={[]} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Пароли не совпадают')
    expect(screen.getByLabelText('Повторите пароль')).toHaveAttribute('aria-invalid', 'true')
  })
})
