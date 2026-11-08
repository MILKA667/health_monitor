import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import DoctorLayout from './components/DoctorLayout'
import FirstLogin from './pages/FirstLogin'
import Login from './pages/Login'
import Recover from './pages/Recover'
import Register from './pages/Register'
import Worklist from './pages/Worklist'

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
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
