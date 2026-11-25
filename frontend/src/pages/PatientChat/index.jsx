import { useEffect, useState } from 'react'
import { getChat, sendChat } from '../../api/patient'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDayTime, formatTime } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

function alertWhen(iso) {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString()
    ? `Сегодня, ${formatTime(iso)}`
    : formatDayTime(iso)
}

// Чат с врачом: системное сообщение об алерте, переписка и отправка
function PatientChat() {
  const [chat, setChat] = useState(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getChat()
      .then((data) => {
        setChat(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  async function handleSend(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || pending) return
    setPending(true)
    setError('')
    try {
      const message = await sendChat(body)
      setChat({ ...chat, messages: [...chat.messages, message] })
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!chat) {
    return (
      <div className="patient-page chat-page">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем переписку…</p>}
      </div>
    )
  }

  return (
    <div className="chat-page">
      <header className="chat-head">
        <h1>Чат с врачом</h1>
        <span className="chat-head__doctor">
          {[chat.doctor.name, chat.doctor.specialty].filter(Boolean).join(', ')} · {chat.doctor.hours}
        </span>
      </header>

      <ol className="chat-list">
        {chat.alert && chat.alert.value && (
          <li className="chat-system">
            {alertWhen(chat.alert.createdAt)} — {chat.alert.value} {chat.alert.unit} вне порога. Врач уведомлён.
          </li>
        )}
        {chat.messages.map((message) => (
          <li key={message.id} className="chat-message">
            <span className="chat-message__meta">
              <span className={message.mine ? 'chat-message__author chat-message__author--me' : 'chat-message__author'}>
                {message.mine ? 'Вы' : message.authorShort}
              </span>{' '}
              <span className="num text-2">{formatTime(message.createdAt)}</span>
            </span>
            <span>{message.body}</span>
          </li>
        ))}
      </ol>

      <form className="chat-composer" onSubmit={handleSend}>
        <FormError>{error}</FormError>
        <div className="chat-composer__row">
          <label className="chat-composer__field">
            <span className="vh">Сообщение врачу</span>
            <textarea
              className="field__control field__control--lg chat-composer__input"
              rows={2}
              placeholder="Сообщение врачу"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <Button variant="primary" size="lg" type="submit" disabled={!draft.trim() || pending}>
            Отправить
          </Button>
        </div>
        <p className="chat-composer__note">
          Чат не для экстренных случаев. При резком ухудшении звоните <a href="tel:103">103</a>.
        </p>
      </form>
    </div>
  )
}

export default PatientChat
