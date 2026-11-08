import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysSince, formatAge, formatDayTime, formatShort, formatToday, patientMeta, plural } from './format'

describe('format', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 28, 10, 42))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает время для сегодняшних событий и дату для прошлых', () => {
    expect(formatShort(new Date(2026, 9, 28, 9, 5).toISOString())).toBe('09:05')
    expect(formatShort(new Date(2026, 9, 25, 8, 10).toISOString())).toBe('25.10')
    expect(formatDayTime(new Date(2026, 9, 27, 21, 5).toISOString())).toBe('27.10 21:05')
  })

  it('пишет день недели и дату', () => {
    expect(formatToday()).toBe('Ср, 28.10.2026')
  })

  it('склоняет слова по числу', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, 'день', 'дня', 'дней')))
      .toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней'])
  })

  it('сокращает возраст как в макетах', () => {
    expect(formatAge(67)).toBe('67 л.')
    expect(formatAge(71)).toBe('71 г.')
    expect(formatAge(34)).toBe('34 г.')
    expect(formatAge(13)).toBe('13 л.')
  })

  it('считает полные дни с момента измерения', () => {
    expect(daysSince(new Date(2026, 9, 25, 8, 10).toISOString())).toBe(3)
  })

  it('собирает подпись пациента', () => {
    expect(patientMeta({ age: 67, policyTail: '4821' })).toBe('67 л. · полис …4821')
    expect(patientMeta({ age: 67, policyTail: null })).toBe('67 л.')
  })
})
