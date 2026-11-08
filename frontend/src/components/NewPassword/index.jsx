import Field from '../Field'
import './style.css'

// Новый пароль с живой проверкой требований и повтором.
// rules: [{ ok, text }] — считает страница, потому что третье требование у каждой своё.
function NewPassword({ password, repeat, onPasswordChange, onRepeatChange, rules }) {
  const mismatch = repeat.length > 0 && repeat !== password

  return (
    <>
      <Field
        label="Новый пароль"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
      />
      <ul aria-label="Требования к паролю" className="password-rules">
        {rules.map((rule) => (
          <li key={rule.text} className={rule.ok ? 'password-rules__ok' : undefined}>
            <span aria-hidden="true" className="password-rules__mark">{rule.ok ? '✓' : '○'}</span>
            <span>
              {rule.text}
              <span className="vh">{rule.ok ? ' — выполнено' : ' — не выполнено'}</span>
            </span>
          </li>
        ))}
      </ul>
      <Field
        label="Повторите пароль"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(e) => onRepeatChange(e.target.value)}
        error={mismatch ? 'Пароли не совпадают' : undefined}
      />
    </>
  )
}

export default NewPassword
