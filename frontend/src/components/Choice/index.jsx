import './style.css'

// Чекбокс или радиокнопка с подписью справа
function Choice({ type = 'checkbox', children, className = '', ...props }) {
  return (
    <label className={`choice ${className}`.trim()}>
      <input type={type} className="choice__input" {...props} />
      <span>{children}</span>
    </label>
  )
}

export default Choice
