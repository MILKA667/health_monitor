import { request } from './client'

// Время — ISO-строки; значения и отклонения уже отформатированы сервером ('2,9', '−1,0 ниже 3,9').
// level: 'crit' | 'warn' | 'ok' | 'none'

// → { name, specialty, openAlerts }
export function getDoctorHeader() {
  return request('/doctor/header')
}

// → { patients: [{ id, name, age, policyTail, nosology, level, last: { value, unit, level, deviation, source, measuredAt } | null, alert }] }
export function getWorklist() {
  return request('/doctor/worklist')
}

// → { id, name, age, policyTail, nosology, alert, measurements: [...], target, device, relative }
export function getPatientSummary(patientId) {
  return request(`/doctor/patients/${patientId}/summary`)
}

export function acceptAlert(alertId, comment) {
  return request(`/doctor/alerts/${alertId}/accept`, { method: 'POST', body: { comment } })
}

export function undoAlert(alertId) {
  return request(`/doctor/alerts/${alertId}/undo`, { method: 'POST' })
}

// Медкарта: шапка, алерт, график, измерения и пороги за 7/14/30 дней.
// → { id, name, sex, age, diagnosis, icdCode, policyTail, enrolledAt, consentAt, device, relative,
//     alert, days, chart, stats, measurements, thresholds, escalationMinutes, lastMeasurementAt }
export function getRecord(patientId, days) {
  return request(`/doctor/patients/${patientId}/record?days=${days}`)
}

// → { days, medications: [{ id, name, schedule, dose, prescribedAt, enabled, taken, expected, percent, lastTakenAt }] }
export function getMedications(patientId) {
  return request(`/doctor/patients/${patientId}/medications`)
}

// → { messages: [{ id, body, createdAt, author, senderRole, mine, read }] }
export function getMessages(patientId) {
  return request(`/doctor/patients/${patientId}/messages`)
}

export function sendMessage(patientId, body) {
  return request(`/doctor/patients/${patientId}/messages`, { method: 'POST', body: { body } })
}

// → { alerts: [{ id, createdAt, level, rule, value, unit, relativeSmsAt, acceptedAt, acceptedBy, escalateAt, escalated }] }
export function getPatientAlerts(patientId) {
  return request(`/doctor/patients/${patientId}/alerts`)
}

// Общий список алертов врача (дежурный видит и эскалированные чужие).
// → { counts: { open, closed, all }, dutyDoctor, alerts: [{ id, patientId, patientName, diagnosis, level,
//     value, unit, rule, createdAt, relativeName, relativeSmsAt, acceptedAt, acceptedBy, escalateAt,
//     escalated, own, canAccept, canUndo }] }
export function getAlerts() {
  return request('/doctor/alerts')
}

// Пороги и правила эскалации. scope: { type: 'patient' | 'nosology', id } или null — тогда первый пациент.
// → { scope, rows: [{ metric, label, unit, values: { crit_low, warn_low, warn_high, crit_high } }],
//     settings: { escalationMinutes, smsRelative, noDataAlert }, scopes: { patients, nosologies } }
export function getThresholds(scope) {
  const query = scope ? `?scope=${scope.type}&id=${encodeURIComponent(scope.id)}` : ''
  return request(`/doctor/thresholds${query}`)
}

// payload: { scope, rows: [{ metric, critLow, warnLow, warnHigh, critHigh }], settings }
export function saveThresholds(payload) {
  return request('/doctor/thresholds', { method: 'POST', body: payload })
}

// Диалоги врача: только пациенты, с которыми есть переписка.
// → { conversations: [{ patientId, name, shortName, diagnosis, unread, lastMessage: { body, mine, createdAt },
//     lastMeasurement: { value, unit, level, measuredAt } | null, alert }] }
export function getConversations() {
  return request('/doctor/messages')
}
