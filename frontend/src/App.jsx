import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import DoctorLayout from './components/DoctorLayout'
import FirstLogin from './pages/FirstLogin'
import Login from './pages/Login'
import Recover from './pages/Recover'
import Register from './pages/Register'
import Worklist from './pages/Worklist'
import Record from './pages/Record'
import Alerts from './pages/Alerts'
import Thresholds from './pages/Thresholds'
import Messages from './pages/Messages'
import Reports from './pages/Reports'
import Report from './pages/Report'
import PatientLayout from './components/PatientLayout'
import PatientHome from './pages/PatientHome'
import PatientEntry from './pages/PatientEntry'
import PatientAlert from './pages/PatientAlert'
import PatientHistory from './pages/PatientHistory'
import PatientReminders from './pages/PatientReminders'
import PatientChat from './pages/PatientChat'
import PatientProfile from './pages/PatientProfile'
import PatientDevices from './pages/PatientDevices'
import PatientPassword from './pages/PatientPassword'

// Этап 1: вход, заявка, восстановление пароля, первый вход.
// Этап 2: врач. Страницы пациента, родственника и администратора добавляются следующими этапами.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/welcome" element={<FirstLogin />} />
        <Route path="/doctor" element={<DoctorLayout />}>
          <Route index element={<Worklist />} />
          <Route path="patients/:patientId" element={<Record />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="thresholds" element={<Thresholds />} />
          <Route path="messages" element={<Messages />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:reportId" element={<Report />} />
        </Route>
        <Route path="/patient" element={<PatientLayout />}>
          <Route index element={<PatientHome />} />
          <Route path="entry" element={<PatientEntry />} />
          <Route path="alert" element={<PatientAlert />} />
          <Route path="history" element={<PatientHistory />} />
          <Route path="reminders" element={<PatientReminders />} />
          <Route path="chat" element={<PatientChat />} />
          <Route path="profile" element={<PatientProfile />} />
          <Route path="devices" element={<PatientDevices />} />
          <Route path="password" element={<PatientPassword />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
