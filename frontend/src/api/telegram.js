import { request } from './client'

// → { linked, botUsername, botLink }
export function getTelegramStatus() {
  return request('/telegram/status')
}

// → { code, expiresInMinutes, botUsername, deepLink }
export function createTelegramCode() {
  return request('/telegram/link-code', { method: 'POST' })
}

export function unlinkTelegram() {
  return request('/telegram/link', { method: 'DELETE' })
}