// Общий клиент для запросов к Flask. В dev-режиме /api проксируется Vite на localhost:5000.
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function request(path, { method = 'GET', body } = {}) {
  let response

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.', 0)
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(data?.error ?? 'Не удалось выполнить запрос. Попробуйте ещё раз.', response.status, data)
  }

  return data
}
