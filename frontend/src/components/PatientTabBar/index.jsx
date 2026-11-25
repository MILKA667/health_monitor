import { NavLink } from 'react-router'
import './style.css'

// Вкладки добавляются вместе с экранами: история, чат и профиль появятся в следующих обновлениях
const PATIENT_TABS = [
  { to: '/patient', label: 'Сегодня', end: true },
  { to: '/patient/history', label: 'История' },
  { to: '/patient/chat', label: 'Чат' },
  { to: '/patient/profile', label: 'Профиль' },
]

// Нижняя навигация пациента; у активной вкладки синяя полоса сверху
function PatientTabBar({ tabs = PATIENT_TABS }) {
  return (
    <nav
      aria-label="Разделы"
      className="patient-tabbar"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className="patient-tabbar__tab">
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default PatientTabBar
