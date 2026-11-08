import { NavLink } from 'react-router'
import './style.css'

const TABS = [
  { to: '/patient', label: 'Сегодня', end: true },
  { to: '/patient/history', label: 'История' },
  { to: '/patient/chat', label: 'Чат' },
  { to: '/patient/profile', label: 'Профиль' },
]

// Нижняя навигация пациента; у активной вкладки синяя полоса сверху
function PatientTabBar() {
  return (
    <nav aria-label="Разделы" className="patient-tabbar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className="patient-tabbar__tab">
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default PatientTabBar
