import { describe, expect, it } from 'vitest'
import { basePasswordRules, digitsOnly, isLogin } from './password'

describe('password', () => {
  it('проверяет длину и наличие букв с цифрами', () => {
    expect(basePasswordRules('abc').map((rule) => rule.ok)).toEqual([false, false])
    expect(basePasswordRules('abcdefgh').map((rule) => rule.ok)).toEqual([true, false])
    expect(basePasswordRules('Пароль12').map((rule) => rule.ok)).toEqual([true, true])
  })

  it('оставляет только цифры', () => {
    expect(digitsOnly('+7 (900) 123-45-67')).toBe('79001234567')
  })

  it('принимает телефон из 10+ цифр или e-mail', () => {
    expect(isLogin('900 123 45 67')).toBe(true)
    expect(isLogin('user@clinic.ru')).toBe(true)
    expect(isLogin('900 123')).toBe(false)
    expect(isLogin('@clinic.ru')).toBe(false)
  })
})
