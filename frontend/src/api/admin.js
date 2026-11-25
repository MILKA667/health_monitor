import { request } from './client'

// Админка: заявки, пользователи и журнал аудита
export function getApplications() {
  return request('/admin/applications')
}

// data зависит от роли заявки: пациент — карта, родственник — patientId, врач — специальность и клиника
export function approveApplication(applicationId, data) {
  return request(`/admin/applications/${applicationId}/approve`, { method: 'POST', body: data })
}

export function rejectApplication(applicationId) {
  return request(`/admin/applications/${applicationId}/reject`, { method: 'POST' })
}

export function revertApplication(applicationId) {
  return request(`/admin/applications/${applicationId}/revert`, { method: 'POST' })
}

export function getUsers({ search = '', role = 'all' } = {}) {
  const params = new URLSearchParams({ search, role })
  return request(`/admin/users?${params}`)
}

export function setUserBlocked(userId, blocked) {
  return request(`/admin/users/${userId}/block`, { method: 'POST', body: { blocked } })
}

export function getAudit(type = 'all') {
  return request(`/admin/audit?type=${type}`)
}
