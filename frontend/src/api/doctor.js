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
