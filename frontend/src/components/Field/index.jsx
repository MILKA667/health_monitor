import { useId } from 'react'
import './style.css'

// Поле с подписью сверху; aside — элемент справа от подписи (например, ссылка «Забыли пароль?»)
function Field({ label, aside, hint, error, size = 'md', className = '', as: Control = 'input', children, ...props }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className={`field ${className}`.trim()}>
      <div className="field__head">
        <label htmlFor={id} className="field__label">{label}</label>
        {aside}
      </div>
      <Control
        id={id}
        className={`field__control field__control--${size}${error ? ' field__control--bad' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      >
        {children}
      </Control>
      {hint && <span id={hintId} className="hint">{hint}</span>}
      {error && <p id={errorId} role="alert" className="field__error">{error}</p>}
    </div>
  )
}

export default Field
