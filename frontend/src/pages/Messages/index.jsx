import { useCallback, useEffect, useState } from 'react'
import { getConversations, getMessages, sendMessage } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDayTime, formatShort, formatTime } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

function lastMeasurementText(measurement) {
  if (!measurement) return null
  return `последний показатель ${measurement.value} ${measurement.unit}, ${formatDayTime(measurement.measuredAt)}`
}

// Переписка врача с пациентами: список диалогов слева, переписка справа
function Messages() {
  const [conversations, setConversations] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const refresh = useCallback(() => {
    return getConversations().then((data) => setConversations(data.conversations))
  }, [])

  const openConversation = useCallback(async (patientId) => {
    setSelectedId(patientId)
    setDraft('')
    setError('')
    try {
      const data = await getMessages(patientId)
      setMessages(data.messages)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }, [refresh])

  useEffect(() => {
    let alive = true
    getConversations()
      .then((data) => {
        if (!alive) return
        setConversations(data.conversations)
        if (data.conversations.length > 0) openConversation(data.conversations[0].patientId)
      })
      .catch((err) => setError(err.message))
    return () => {
      alive = false
    }
  }, [openConversation])

  async function handleSend(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selectedId || sending) return
    setSending(true)
    setError('')
    try {
      const message = await sendMessage(selectedId, body)
      setMessages((current) => [...current, message])
      setDraft('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const query_ = query.trim().toLowerCase()
  const visible = (conversations ?? []).filter(
    (conversation) => !query_ || conversation.name.toLowerCase().includes(query_),
  )
  const active = (conversations ?? []).find((conversation) => conversation.patientId === selectedId)

  return (
    <main className="messages">
      <FormError>{error}</FormError>

      <div className="messages__layout">
        <section className="panel messages__dialogs" aria-label="Диалоги">
          <div className="messages__dialogs-head">
            <h1>Сообщения</h1>
            <label>
              <span className="vh">Поиск по ФИО</span>
              <input
                type="search"
                className="field__control field__control--sm messages__search"
                placeholder="Поиск по ФИО"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {conversations === null && <p className="messages__empty text-2">Загружаем переписку…</p>}
          {conversations !== null && visible.length === 0 && (
            <p className="messages__empty text-2">
              {conversations.length === 0
                ? 'Переписок пока нет. Начните разговор из медкарты пациента.'
                : 'Никого не нашли по этому имени.'}
            </p>
          )}

          {visible.map((conversation) => (
            <button
              key={conversation.patientId}
              type="button"
              className={`messages__dialog${conversation.patientId === selectedId ? ' messages__dialog--active' : ''}`}
              aria-pressed={conversation.patientId === selectedId}
              onClick={() => openConversation(conversation.patientId)}
            >
              <span className="messages__dialog-top">
                <span className={`messages__dialog-name${conversation.unread > 0 ? ' messages__dialog-name--unread' : ''}`}>
                  {conversation.shortName}
                </span>
                <span className="num messages__time">{formatShort(conversation.lastMessage.createdAt)}</span>
              </span>
              <span className="messages__dialog-bottom">
                <span className="messages__preview">
                  {conversation.lastMessage.mine ? 'Вы: ' : ''}
                  {conversation.lastMessage.body}
                </span>
                {conversation.unread > 0 && (
                  <span className="messages__unread num">
                    {conversation.unread}
                    <span className="vh"> непрочитанных</span> нов.
                  </span>
                )}
              </span>
            </button>
          ))}
        </section>

        <section className="panel messages__thread" aria-label="Переписка">
          {active ? (
            <>
              <div className="messages__thread-head">
                <div className="messages__thread-title">
                  <h2>{active.name}</h2>
                  <span className="text-2">
                    {[active.diagnosis, lastMeasurementText(active.lastMeasurement)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Button size="sm" to={`/doctor/patients/${active.patientId}`}>Открыть медкарту</Button>
              </div>

              <ol className="messages__list">
                {active.alert && (
                  <li className="messages__system">
                    Система · <span className="num">{formatTime(active.alert.createdAt)}</span> — критический алерт:{' '}
                    {active.alert.value} {active.alert.unit}.
                    {active.alert.relativeSmsAt ? ' Родственник уведомлён SMS.' : ''}
                  </li>
                )}
                {messages.map((message) => (
                  <li key={message.id} className="messages__message">
                    <span className="messages__meta">
                      <span className={message.mine ? 'messages__author' : ''}>{message.author}</span>{' '}
                      <span className="num text-2">{formatTime(message.createdAt)}</span>
                    </span>
                    <span>{message.body}</span>
                  </li>
                ))}
              </ol>

              <form className="messages__composer" onSubmit={handleSend}>
                <label className="messages__field">
                  <span className="vh">Сообщение пациенту</span>
                  <textarea
                    className="field__control field__control--sm messages__input"
                    rows={2}
                    placeholder="Сообщение пациенту"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <Button variant="primary" type="submit" disabled={!draft.trim() || sending}>
                  Отправить
                </Button>
              </form>
              <p className="messages__note text-2">
                Сообщения сохраняются в медкарте. Хранение и обработка — на серверах в РФ.
              </p>
            </>
          ) : (
            <p className="messages__empty text-2">Выберите диалог слева.</p>
          )}
        </section>
      </div>
    </main>
  )
}

export default Messages
