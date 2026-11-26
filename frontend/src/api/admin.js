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

// Новый временный пароль: возвращается один раз для показа администратору
export function resetUserPassword(userId) {
  return request(`/admin/users/${userId}/reset-password`, { method: 'POST' })
}

// Удаление аккаунта: вход запрещён, контакты очищаются, медданные остаются
export function deleteUser(userId) {
  return request(`/admin/users/${userId}/delete`, { method: 'POST' })
}

export function getAudit(type = 'all') {
  return request(`/admin/audit?type=${type}`)
}

// Метрики продукта за период (7, 14, 30 или 90 дней)
export function getAnalytics(days = 30) {
  return request(`/admin/analytics?days=${days}`)
}
