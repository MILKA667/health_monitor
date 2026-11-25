import { NavLink } from 'react-router'
import './style.css'

const SECTIONS = [
  { to: '/doctor', label: 'Пациенты', end: true },
  { to: '/doctor/alerts', label: 'Алерты', counter: true },
  { to: '/doctor/messages', label: 'Сообщения' },
  { to: '/doctor/reports', label: 'Отчёты' },
  { to: '/doctor/thresholds', label: 'Пороги' },
]

// Шапка врача: разделы с подчёркиванием активного, счётчик открытых алертов, ФИО и «Выйти»
function Header({ openAlerts = 0, userName, userRole, onLogout }) {
  return (
    <header className="header">
      <span className="header__brand">HealthMonitor</span>
      <nav aria-label="Разделы" className="header__nav">
        {SECTIONS.map((section) => (
          <NavLink key={section.to} to={section.to} end={section.end} className="header__link">
            {section.label}
            {section.counter && openAlerts > 0 && (
              <span className="header__counter">
                {openAlerts}
                <span className="vh"> открытых</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <span className="header__user">
        {[userName, userRole].filter(Boolean).join(' · ')}
        {' · '}
        <button type="button" className="header__logout" onClick={onLogout}>Выйти</button>
      </span>
    </header>
  )
}

export default Header
