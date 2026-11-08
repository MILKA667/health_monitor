import { request } from './client'

// Ошибки сервер возвращает как { error: 'текст для пользователя' } с кодом 4xx.

// → { role: 'doctor' | 'patient' | 'relative' | 'admin', mustChangePassword: boolean }
export function login(login, password) {
  return request('/auth/login', { method: 'POST', body: { login, password } })
}

export function logout() {
  return request('/auth/logout', { method: 'POST' })
}

// application: { role: 'patient' | 'relative' | 'doctor', name, phone, email, extra, consents: { personalData, noDiagnosis } }
export function register(application) {
  return request('/auth/register', { method: 'POST', body: application })
}

// → { masked: '+7 ••• ••• 18 52' }
export function requestRecoveryCode(login) {
  return request('/auth/recover/code', { method: 'POST', body: { login } })
}

// → { token }. Неверный код: 400 { error, attemptsLeft }; после 3 ошибок attemptsLeft = 0
export function verifyRecoveryCode(login, code) {
  return request('/auth/recover/verify', { method: 'POST', body: { login, code } })
}

export function resetPassword(token, password) {
  return request('/auth/recover/reset', { method: 'POST', body: { token, password } })
}

// Первый вход пациента по временному паролю.
// → { name, birthDate: 'ДД.ММ.ГГГГ', phoneMasked, doctor: { name, shortName, specialty }, clinic }
export function getWelcomeProfile() {
  return request('/welcome/profile')
}

// data: { password, consents: { personalData, noDiagnosis }, relative: { name, phone } | null }
export function completeWelcome(data) {
  return request('/welcome/complete', { method: 'POST', body: data })
}
