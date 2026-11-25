import { request } from './client'

// Главная пациента: последний показатель, план на сегодня и последние измерения.
// → { name, kind, kindTitle, target, limits, last, recent, plan: { done, total, items } }
export function getHome() {
  return request('/patient/home')
}

// Отметка о приёме лекарства на сегодня
export function toggleIntake(slotId, done) {
  return request(`/patient/plan/medications/${slotId}`, { method: 'POST', body: { done } })
}

// data: { kind, value, value2?, context, wellbeing: [] }
// → { measurement, alert | null }
export function addMeasurement(data) {
  return request('/patient/measurements', { method: 'POST', body: data })
}

// Последний критический алерт для экрана «Сахар ниже допустимого»
export function getLatestAlert() {
  return request('/patient/alerts/latest')
}

// История измерений за 7 или 14 дней
// → { days, kind, kindTitle, target, chart, stats, measurements }
export function getHistory(days) {
  return request(`/patient/measurements?days=${days}`)
}
