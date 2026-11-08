import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import FirstLogin from './pages/FirstLogin'
import Login from './pages/Login'
import Recover from './pages/Recover'
import Register from './pages/Register'

// Этап 1: вход, заявка, восстановление пароля, первый вход.
// Страницы врача, пациента, родственника и администратора добавляются следующими этапами.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/welcome" element={<FirstLogin />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
