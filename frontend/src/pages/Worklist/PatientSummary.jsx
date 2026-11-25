import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router'
import { acceptAlert, getPatientSummary, undoAlert } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { DEVICE_NAMES, formatDayTime, formatTime, NOSOLOGY_SHORT, patientMeta } from '../../utils/format'

function deviceText(device) {
  if (!device) return 'нет, ввод вручную'
  const name = DEVICE_NAMES[device.kind]
  if (!device.connected) return `${name}, отключён`
  if (!device.lastSync) return `${name}, ещё не синхронизирован`
  return `${name}, синхр. ${formatDayTime(device.lastSync)}`
}

function relativeText(relative, alert) {
  if (!relative) return 'не указан'
  const sms = alert?.relativeSmsAt ? ` · SMS ${formatTime(alert.relativeSmsAt)}` : ''
  return `${relative.name}${sms}`
}

function alertText(alert, measurement) {
  const value = `Значение ${measurement.value} ${measurement.unit}.`
  if (alert.acceptedAt) {
    const comment = alert.comment ? ` «${alert.comment}»` : ''
    return `${value} Принят в ${formatTime(alert.acceptedAt)} · ${alert.acceptedBy}.${comment}`
  }
  if (alert.escalated) return `${value} Без реакции — передан дежурному врачу в ${formatTime(alert.escalateAt)}.`
  return `${value} Без реакции в ${formatTime(alert.escalateAt)} алерт уйдёт дежурному врачу.`
}

// Сводка по выбранному пациенту справа от рабочего списка
function PatientSummary({ patientId, onChange }) {
  const { refreshHeader } = useOutletContext()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    getPatientSummary(patientId)
      .then((data) => {
        setSummary(data)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [patientId])

  useEffect(load, [load])

  async function toggleAlert() {
    setPending(true)
    setError('')
    try {
      const alert = summary.alert.acceptedAt ? await undoAlert(summary.alert.id) : await acceptAlert(summary.alert.id)
      setSummary({ ...summary, alert })
      onChange()
      refreshHeader()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!summary || summary.id !== patientId) {
    return (
      <aside aria-label="Сводка по пациенту" className="panel summary">
        {error ? <FormError>{error}</FormError> : <p className="summary__loading text-2">Загружаем…</p>}
      </aside>
    )
  }

  const { alert } = summary
  const last = summary.measurements[0]

  return (
    <aside aria-label="Сводка по пациенту" className="panel summary">
      <div className="summary__head">
        <h2>{summary.name}</h2>
        <span className="text-2">{patientMeta(summary)} · {NOSOLOGY_SHORT[summary.nosology]}</span>
      </div>

      {alert && (
        <div className={`summary__alert${alert.acceptedAt ? ' summary__alert--accepted' : ''}`}>
          <span className="summary__alert-title">Критический алерт · {formatTime(alert.createdAt)}</span>
          <span>{alertText(alert, last)}</span>
          {(!alert.acceptedAt || alert.acceptedByMe) && (
            <div className="summary__alert-actions">
              <Button
                variant={alert.acceptedAt ? 'secondary' : 'danger'}
                size="sm"
                onClick={toggleAlert}
                disabled={pending}
              >
                {alert.acceptedAt ? 'Отменить принятие' : 'Принять алерт'}
              </Button>
            </div>
          )}
        </div>
      )}
      <FormError>{error}</FormError>

      <div className="summary__caption">Последние измерения</div>
      {summary.measurements.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col" className="data-table__num">Значение</th>
              <th scope="col">Источник</th>
            </tr>
          </thead>
          <tbody>
            {summary.measurements.map((m) => (
              <tr key={m.id}>
                <td className="num">{formatDayTime(m.measuredAt)}</td>
                <td className={`num data-table__num summary__value summary__value--${m.level}`}>
                  {m.value}
                  {m.level !== 'ok' && <span className="vh"> — {m.level === 'crit' ? 'критично' : 'вне цели'}</span>}
                </td>
                <td>{m.source === 'device' ? DEVICE_NAMES[summary.device?.kind] ?? 'Устройство' : 'Вручную'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="summary__empty text-2">Измерений пока нет.</p>
      )}

      <dl className="summary__facts">
        <dt>Цель</dt><dd className="num">{summary.target}</dd>
        <dt>Устройство</dt><dd>{deviceText(summary.device)}</dd>
        <dt>Родственник</dt><dd>{relativeText(summary.relative, alert)}</dd>
      </dl>
      <div className="summary__actions">
        <Button variant="primary" size="sm" to={`/doctor/patients/${summary.id}`}>Открыть медкарту</Button>
      </div>
    </aside>
  )
}

export default PatientSummary
