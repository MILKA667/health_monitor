// Форматирование дат, времени и подписей для интерфейса

export const NOSOLOGY_SHORT = {
  diabetes: 'Сахарный диабет',
  hypertension: 'Гипертония',
  asthma: 'Астма',
}

export const NOSOLOGY_FULL = {
  diabetes: 'Сахарный диабет',
  hypertension: 'Артериальная гипертония',
  asthma: 'Бронхиальная астма',
}

export const DEVICE_NAMES = {
  glucometer: 'Глюкометр',
  tonometer: 'Тонометр',
  peakflow: 'Пикфлоуметр',
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const pad = (n) => String(n).padStart(2, '0')

function isToday(date) {
  return date.toDateString() === new Date().toDateString()
}

// 10:38
export function formatTime(iso) {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 28.10
export function formatDay(iso) {
  const date = new Date(iso)
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
}

// Сегодня — время, раньше — дата
export function formatShort(iso) {
  return isToday(new Date(iso)) ? formatTime(iso) : formatDay(iso)
}

// 28.10 10:38
export function formatDayTime(iso) {
  return `${formatDay(iso)} ${formatTime(iso)}`
}

// Ср, 28.10.2026
export function formatToday(date = new Date()) {
  return `${WEEKDAYS[date.getDay()]}, ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

export function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

// 67 л., 71 г.
export function formatAge(age) {
  return `${age} ${plural(age, 'г.', 'г.', 'л.')}`
}

export function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// «67 л. · полис …4821»
export function patientMeta(patient) {
  return [formatAge(patient.age), patient.policyTail && `полис …${patient.policyTail}`].filter(Boolean).join(' · ')
}
