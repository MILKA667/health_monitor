import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { getMe } from '../../api/auth'
import PatientTabBar from '../PatientTabBar'
import { ROLE_HOME } from '../../utils/roles'
import FormError from '../FormError'
import './style.css'

// Каркас мобильных экранов пациента: верхняя строка с именем и нижняя навигация
function PatientLayout() {
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getMe()
      .then((user) => {
        if (user.mustChangePassword) navigate('/welcome', { replace: true })
        else if (user.role !== 'patient') navigate(ROLE_HOME[user.role] ?? '/login', { replace: true })
        else setMe(user)
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 403) navigate('/login', { replace: true })
        else setError(err.message)
      })
  }, [navigate])

  if (!me) {
    return (
      <div className="patient-layout">
        {error ? <div className="patient-layout__error"><FormError>{error}</FormError></div> : null}
      </div>
    )
  }

  return (
    <div className="patient-layout">
      <div className="patient-topbar">
        <span className="patient-topbar__brand">HealthMonitor</span>
        <span>{me.shortName}</span>
      </div>
      <div className="patient-main">
        <Outlet context={{ me }} />
      </div>
      <PatientTabBar />
    </div>
  )
}

export default PatientLayout
