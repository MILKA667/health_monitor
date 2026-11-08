import './style.css'

// Ошибка формы целиком (например, ответ сервера)
function FormError({ children }) {
  if (!children) return null
  return <p role="alert" className="form-error">{children}</p>
}

export default FormError
