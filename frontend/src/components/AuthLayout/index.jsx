import { Link } from 'react-router'
import './style.css'

// Каркас экранов входа: название сверху, форма в панели по центру, сноска снизу.
// width — ширина колонки (400 / 440 / 560), aside — ссылка справа от названия,
// brandLink — название ведёт на страницу входа.
function AuthLayout({ width = 440, subtitle, aside, brandLink = false, footnote, children }) {
  return (
    <div className="auth-layout" style={{ '--auth-width': `${width}px` }}>
      <div className={`auth-layout__top${subtitle ? ' auth-layout__top--stacked' : ''}`}>
        {brandLink ? (
          <Link to="/login" className="auth-layout__brand auth-layout__brand--link">HealthMonitor</Link>
        ) : (
          <span className="auth-layout__brand">HealthMonitor</span>
        )}
        {subtitle && <span className="text-2">{subtitle}</span>}
        {aside}
      </div>

      <main className="auth-layout__panel">{children}</main>

      {footnote && <p className="auth-layout__footnote hint">{footnote}</p>}
    </div>
  )
}

export default AuthLayout
