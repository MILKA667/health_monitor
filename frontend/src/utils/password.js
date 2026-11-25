// Общие требования к паролю; третье требование у каждой формы своё
export function basePasswordRules(password) {
  return [
    { ok: password.length >= 8, text: 'не короче 8 символов' },
    { ok: /[A-Za-zА-Яа-яЁё]/.test(password) && /\d/.test(password), text: 'буквы и хотя бы одна цифра' },
  ]
}

export function digitsOnly(value) {
  return value.replace(/\D/g, '')
}

// Телефон из 10+ цифр или e-mail
export function isLogin(value) {
  const trimmed = value.trim()
  return trimmed.indexOf('@') > 0 || digitsOnly(trimmed).length >= 10
}
