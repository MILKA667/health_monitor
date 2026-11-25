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

// Напоминания: лекарства и замеры
export function getReminders() {
  return request('/patient/reminders')
}

export function setMedicationReminder(slotId, enabled) {
  return request(`/patient/reminders/medications/${slotId}`, { method: 'POST', body: { enabled } })
}

export function setMeasurementReminder(reminderId, enabled) {
  return request(`/patient/reminders/measurements/${reminderId}`, { method: 'POST', body: { enabled } })
}

export function addMeasurementReminder({ kind, time }) {
  return request('/patient/reminders/measurements', { method: 'POST', body: { kind, time } })
}

// Переписка с врачом: врач и часы ответа, последний алерт, сообщения
export function getChat() {
  return request('/patient/chat')
}

export function sendChat(body) {
  return request('/patient/chat', { method: 'POST', body: { body } })
}
