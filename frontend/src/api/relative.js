import { request } from './client'

// Экран родственника: показатели и алерты близкого
export function getRelativeHome() {
  return request('/relative/home')
}

export function setRelativePush(push) {
  return request('/relative/notifications', { method: 'POST', body: { push } })
}
