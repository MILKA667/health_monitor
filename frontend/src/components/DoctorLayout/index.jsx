import { useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { logout } from '../../api/auth'
import { getDoctorHeader } from '../../api/doctor'
import Header from '../Header'
import './style.css'

// Каркас страниц врача: шапка со счётчиком открытых алертов.
// Без сеанса врача — на страницу входа. Страницы обновляют счётчик через refreshHeader из контекста.
function DoctorLayout() {
  const navigate = useNavigate()
  const [header, setHeader] = useState(null)

  const refreshHeader = useCallback(() => {
    getDoctorHeader()
      .then(setHeader)
      .catch((err) => {
        if (err.status === 401 || err.status === 403) navigate('/login', { replace: true })
      })
  }, [navigate])

  useEffect(refreshHeader, [refreshHeader])

  async function handleLogout() {
    await logout().catch(() => {})
    navigate('/login')
  }

  if (!header) return null

  return (
    <div className="doctor-layout">
      <Header
        openAlerts={header.openAlerts}
        userName={header.name}
        userRole={header.specialty}
        onLogout={handleLogout}
      />
      <Outlet context={{ refreshHeader }} />
    </div>
  )
}

export default DoctorLayout
