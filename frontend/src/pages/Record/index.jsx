import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'
import {
  acceptAlert,
  getMedications,
  getMessages,
  getPatientAlerts,
  getRecord,
  sendMessage,
  undoAlert,
} from '../../api/doctor'
import AlertBar from '../../components/AlertBar'
import Button from '../../components/Button'
import Chart from '../../components/Chart'
import FormError from '../../components/FormError'
import SegmentedControl from '../../components/SegmentedControl'
import TextTabs from '../../components/TextTabs'
import { DEVICE_NAMES, formatDate, formatDayTime, formatTime, minutesBetween } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const TABS = [
  { id: 'vitals', label: 'Показатели' },
  { id: 'meds', label: 'Назначения' },
  { id: 'chat', label: 'Переписка' },
  { id: 'log', label: 'Журнал алертов' },
]

const PERIODS = [
  { value: 7, label: '7 дн.' },
  { value: 14, label: '14 дн.' },
  { value: 30, label: '30 дн.' },
]

const LEVEL_LABELS = { crit: 'Критично', warn: 'Внимание', nodata: 'Нет данных' }

function deviceText(device) {
  if (!device) return 'нет, ввод вручную'
  const name = DEVICE_NAMES[device.kind] ?? 'Устройство'
  if (!device.connected) return `${name}, отключён`
  return device.lastSync ? `${name}, синхр. ${formatDayTime(device.lastSync)}` : `${name}, ещё не синхронизирован`
}

function relativeText(relative) {
  if (!relative) return 'не указан'
  const phone = relative.phoneMasked ? `, ${relative.phoneMasked}` : ''
  return `${relative.name}${phone}${relative.smsAlerts ? ', SMS при критичном' : ', SMS выключены'}`
}

function alertTitle(record) {
  const { alert } = record
  if (alert.acceptedAt) return `Алерт принят в ${formatTime(alert.acceptedAt)} · ${alert.acceptedBy}`
  const latest = record.measurements[0]
  const value = latest ? ` · ${latest.value} ${latest.unit}` : ''
  return `Критический алерт${value} · ${formatTime(alert.createdAt)}`
}

function alertText(record) {
  const { alert } = record
  if (alert.acceptedAt) return alert.comment ? `Комментарий: ${alert.comment}` : 'Эскалация отменена.'
  const latest = record.measurements[0]
  const rule = alert.rule ? alert.rule.charAt(0).toLowerCase() + alert.rule.slice(1) : 'значение за критическим порогом'
  const notified = alert.relativeSmsAt ? 'Врач и родственник уведомлены.' : 'Врач уведомлён.'
  const escalate = alert.escalated
    ? `Алерт передан дежурному врачу в ${formatTime(alert.escalateAt)}.`
    : `Без реакции в ${formatTime(alert.escalateAt)} алерт уйдёт дежурному врачу.`
  const value = latest ? `Значение ${latest.value} ${latest.unit}: ` : 'Значение: '
  return `${value}${rule}. ${notified} ${escalate}`
}

function messageText(alert) {
  if (!alert || alert.level !== 'crit' || !alert.value) return 'врач'
  return alert.relativeSmsAt ? 'врач, родственник (SMS)' : 'врач'
}

function reactionText(alert) {
  if (alert.acceptedAt) {
    const minutes = minutesBetween(alert.createdAt, alert.acceptedAt)
    const wait = minutes > 0 ? ` через ${minutes} мин` : ''
    return `принят${wait}, ${alert.acceptedBy}`
  }
  if (alert.escalated) return `передан дежурному в ${formatTime(alert.escalateAt)}`
  if (alert.level === 'crit' && alert.escalateAt) return `ожидает · эскалация в ${formatTime(alert.escalateAt)}`
  return '—'
}

// Медкарта пациента: шапка с данными, активный алерт и четыре раздела
function Record() {
  const { patientId } = useParams()
  // Ключ сбрасывает состояние разделов при переходе к другому пациенту
  return <RecordView key={patientId} patientId={patientId} />
}

function RecordView({ patientId }) {
  const outlet = useOutletContext()
  const [days, setDays] = useState(14)
  const [tab, setTab] = useState('vitals')
  const [record, setRecord] = useState(null)
  const [medications, setMedications] = useState(null)
  const [messages, setMessages] = useState(null)
  const [alertLog, setAlertLog] = useState(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    getRecord(patientId, days)
      .then((data) => {
        setRecord(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [patientId, days])

  useEffect(load, [load])

  // Разделы подгружаются при первом открытии
  useEffect(() => {
    if (tab === 'meds' && !medications) {
      getMedications(patientId).then((data) => setMedications(data.medications)).catch((err) => setError(err.message))
    }
    if (tab === 'chat' && !messages) {
      getMessages(patientId).then((data) => setMessages(data.messages)).catch((err) => setError(err.message))
    }
    if (tab === 'log' && !alertLog) {
      getPatientAlerts(patientId).then((data) => setAlertLog(data.alerts)).catch((err) => setError(err.message))
    }
  }, [tab, patientId, medications, messages, alertLog])

  async function toggleAlert() {
    setPending(true)
    setError('')
    try {
      const alert = record.alert.acceptedAt
        ? await undoAlert(record.alert.id)
        : await acceptAlert(record.alert.id, note.trim() || undefined)
      setRecord({ ...record, alert })
      setNote('')
      setAlertLog(null)
      outlet?.refreshHeader?.()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || pending) return
    setPending(true)
    setError('')
    try {
      const message = await sendMessage(patientId, body)
      setMessages([...(messages ?? []), message])
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!record) {
    return (
      <main>
        {error ? <div className="page-body"><FormError>{error}</FormError></div> : <p className="record__loading text-2">Загружаем медкарту…</p>}
      </main>
    )
  }

  const latest = record.measurements[0]

  return (
    <>
      <section className="record-head" aria-label="Пациент">
        <div className="record-head__title">
          <h1>{record.name}</h1>
          <span className="text-2">
            {[record.sex, record.age && `${record.age} лет`, record.diagnosis && `${record.diagnosis} (${record.icdCode})`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>

        <dl className="record-facts">
          <div><dt>Полис</dt><dd className="num">{record.policyTail ? `…${record.policyTail}` : '—'}</dd></div>
          <div><dt>В программе с</dt><dd className="num">{formatDate(record.enrolledAt)}</dd></div>
          <div><dt>Устройство</dt><dd>{deviceText(record.device)}</dd></div>
          <div><dt>Родственник</dt><dd>{relativeText(record.relative)}</dd></div>
          <div>
            <dt>Согласие на обработку ПДн</dt>
            <dd>{record.consentAt ? `подписано ${formatDate(record.consentAt)}` : 'не подписано'}</dd>
          </div>
        </dl>

        {record.alert && (
          <div className="record-alert">
            <AlertBar
              title={alertTitle(record)}
              text={alertText(record)}
              accepted={Boolean(record.alert.acceptedAt)}
              comment={note}
              onCommentChange={setNote}
              onAccept={toggleAlert}
              onUndo={toggleAlert}
              disabled={pending}
            />
          </div>
        )}

        <div className="record-tabs">
          <TextTabs tabs={TABS} value={tab} onChange={setTab} label="Разделы медкарты" />
        </div>
      </section>

      <main className="record-body">
        <FormError>{error}</FormError>

        {tab === 'vitals' && (
          <div className="record-vitals">
            <section className="record-panel record-panel--chart" aria-labelledby="record-chart-title">
              <div className="record-chart__head">
                <h2 id="record-chart-title">{record.chart.title}</h2>
                <SegmentedControl options={PERIODS} value={days} onChange={setDays} label="Период" />
              </div>
              {record.stats.length > 0 && (
                <div className="record-stats">
                  {record.stats.map((stat) => (
                    <span key={stat.label}>
                      {stat.label} <span className={`num record-stats__value${stat.tone ? ` record-stats__value--${stat.tone}` : ''}`}>{stat.value}</span>
                    </span>
                  ))}
                </div>
              )}
              {record.chart.series.some((series) => series.label) && (
                <div className="record-legend">
                  {record.chart.series.map((series, index) => (
                    <span key={series.id} className="record-legend__item">
                      <span className={`record-legend__line record-legend__line--${index}`} aria-hidden="true" />
                      {series.label}
                    </span>
                  ))}
                </div>
              )}
              <Chart
                chart={record.chart}
                label={`${record.chart.title} за ${days} дней, последнее значение ${latest ? `${latest.value} ${latest.unit}` : 'нет'}`}
              />
            </section>

            <section className="record-panel record-panel--measurements" aria-labelledby="record-measurements-title">
              <h2 id="record-measurements-title" className="record-panel__title">Измерения</h2>
              <div className="record-scroll">
                {record.measurements.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Дата, время</th>
                        <th scope="col" className="data-table__num">{latest?.unit}</th>
                        <th scope="col">Контекст</th>
                        <th scope="col">Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.measurements.map((measurement) => (
                        <tr key={measurement.id}>
                          <td className="num">{formatDayTime(measurement.measuredAt)}</td>
                          <td className={`num data-table__num record-value record-value--${measurement.level}`}>
                            {measurement.value}
                            {measurement.level !== 'ok' && (
                              <span className="vh"> — {measurement.level === 'crit' ? 'критично' : 'вне цели'}</span>
                            )}
                          </td>
                          <td>{measurement.context}</td>
                          <td>{measurement.sourceLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="record-panel__empty text-2">Измерений за период нет.</p>
                )}
              </div>
              <dl className="record-thresholds">
                {record.thresholds.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd className="num">{row.value}</dd>
                  </div>
                ))}
                <div>
                  <dt>Эскалация</dt>
                  <dd>через {record.escalationMinutes} мин без реакции → дежурный врач</dd>
                </div>
              </dl>
            </section>
          </div>
        )}

        {tab === 'meds' && (
          <section className="record-panel" aria-labelledby="record-meds-title">
            <h2 id="record-meds-title" className="record-panel__title">Назначения</h2>
            <div className="record-scroll">
              {medications?.length ? (
                <table className="data-table record-meds">
                  <thead>
                    <tr>
                      <th scope="col">Препарат</th>
                      <th scope="col">Схема</th>
                      <th scope="col">Назначен</th>
                      <th scope="col">Приём за 14 дней</th>
                      <th scope="col">Последний приём</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medications.map((medication) => (
                      <tr key={medication.id}>
                        <td className="record-meds__name">{medication.name}</td>
                        <td>
                          {medication.schedule}
                          {medication.dose && <span className="record-meds__dose text-2">{medication.dose}</span>}
                        </td>
                        <td className="num">{formatDate(medication.prescribedAt)}</td>
                        <td>
                          <span className="num">{medication.taken} / {medication.expected}</span>
                          {medication.percent !== null && <span className="text-2"> · {medication.percent}%</span>}
                        </td>
                        <td className="num">{medication.lastTakenAt ? formatDayTime(medication.lastTakenAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="record-panel__empty text-2">Назначений нет.</p>
              )}
            </div>
            <p className="record-panel__note text-2">
              Отметки о приёме вносит пациент. Изменение назначений выполняется в МИС клиники.
            </p>
          </section>
        )}

        {tab === 'chat' && (
          <section className="record-panel record-chat" aria-labelledby="record-chat-title">
            <h2 id="record-chat-title" className="vh">Переписка с пациентом</h2>
            <ol className="record-chat__list">
              {record.alert?.level === 'crit' && latest && (
                <li className="record-chat__system">
                  Система · <span className="num">{formatTime(record.alert.createdAt)}</span> — критический алерт:{' '}
                  {latest.value} {latest.unit}.{record.alert.relativeSmsAt ? ' Родственник уведомлён SMS.' : ''}
                </li>
              )}
              {(messages ?? []).map((message) => (
                <li key={message.id} className="record-chat__message">
                  <span className="record-chat__meta">
                    <span className={message.mine ? 'record-chat__author' : ''}>{message.author}</span>{' '}
                    <span className="num text-2">{formatTime(message.createdAt)}</span>
                  </span>
                  <span>{message.body}</span>
                </li>
              ))}
            </ol>
            {messages?.length === 0 && <p className="record-chat__empty text-2">Сообщений ещё нет.</p>}
            <form className="record-chat__composer" onSubmit={handleSend}>
              <label className="record-chat__field">
                <span className="vh">Сообщение пациенту</span>
                <textarea
                  className="field__control field__control--sm record-chat__input"
                  rows={2}
                  placeholder="Сообщение пациенту"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <Button variant="primary" type="submit" disabled={!draft.trim() || pending}>Отправить</Button>
            </form>
            <p className="record-panel__note text-2">
              Сообщения сохраняются в медкарте. Хранение и обработка — на серверах в РФ.
            </p>
          </section>
        )}

        {tab === 'log' && (
          <section className="record-panel" aria-labelledby="record-log-title">
            <h2 id="record-log-title" className="record-panel__title">Журнал алертов</h2>
            <div className="record-scroll">
              {alertLog?.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Время</th>
                      <th scope="col">Показатель</th>
                      <th scope="col">Уровень</th>
                      <th scope="col">Уведомлены</th>
                      <th scope="col">Реакция</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertLog.map((alert) => (
                      <tr key={alert.id}>
                        <td className="num">{formatDayTime(alert.createdAt)}</td>
                        <td className="num">
                          {alert.value ? `${alert.value} ${alert.unit}` : alert.rule}
                        </td>
                        <td className={`record-level record-level--${alert.level}`}>{LEVEL_LABELS[alert.level]}</td>
                        <td>{messageText(alert)}</td>
                        <td>{reactionText(alert)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="record-panel__empty text-2">Алертов не было.</p>
              )}
            </div>
          </section>
        )}
      </main>
    </>
  )
}

export default Record
