import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getReport } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDayTime } from '../../utils/format'
import './style.css'

const LEVEL_LABELS = { crit: 'Критично', warn: 'Внимание', nodata: 'Нет данных' }

function reaction(item) {
  if (item.responseMinutes !== null) return `принят через ${item.responseMinutes} мин · ${item.acceptedBy}`
  if (item.escalated) return 'эскалирован дежурному врачу'
  return 'ожидает'
}

function PatientSections({ patient }) {
  return (
    <>
      <section className="report__section">
        <h2>Пациент</h2>
        <dl className="report__facts">
          <div><dt>ФИО</dt><dd>{patient.name}</dd></div>
          <div><dt>Пол, возраст</dt><dd>{patient.sex}, {patient.age} лет</dd></div>
          <div><dt>Диагноз</dt><dd>{patient.diagnosis} ({patient.icdCode})</dd></div>
          <div><dt>Полис</dt><dd className="num">{patient.policyTail ? `…${patient.policyTail}` : '—'}</dd></div>
        </dl>
      </section>

      {patient.dynamics && (
        <section className="report__section">
          <h2>Динамика показателей</h2>
          <div className="report__stats">
            {patient.dynamics.stats.map((stat) => (
              <span key={stat.label}>
                {stat.label} <span className={`num${stat.tone ? ` report__tone--${stat.tone}` : ''}`}>{stat.value}</span>
              </span>
            ))}
          </div>
          {patient.dynamics.measurements.length > 0 ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th scope="col">Дата, время</th>
                  <th scope="col" className="report__num">Значение</th>
                  <th scope="col">Контекст</th>
                  <th scope="col">Источник</th>
                </tr>
              </thead>
              <tbody>
                {patient.dynamics.measurements.map((row) => (
                  <tr key={`${row.measuredAt}-${row.value}`}>
                    <td className="num">{formatDayTime(row.measuredAt)}</td>
                    <td className={`num report__num report__tone--${row.level}`}>
                      {row.value} <span className="report__unit">{row.unit}</span>
                    </td>
                    <td>{row.context || '—'}</td>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-2">Измерений за период нет.</p>
          )}
          <dl className="report__facts report__facts--tight">
            {patient.dynamics.thresholds.map((row) => (
              <div key={row.label}><dt>{row.label}</dt><dd className="num">{row.value}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {patient.alerts && (
        <section className="report__section">
          <h2>Алерты и время реакции</h2>
          {patient.alerts.length > 0 ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th scope="col">Время</th>
                  <th scope="col">Показатель</th>
                  <th scope="col">Уровень</th>
                  <th scope="col">Реакция</th>
                </tr>
              </thead>
              <tbody>
                {patient.alerts.map((alert) => (
                  <tr key={`${alert.createdAt}-${alert.rule}`}>
                    <td className="num">{formatDayTime(alert.createdAt)}</td>
                    <td className="num">{alert.value ? `${alert.value} ${alert.unit}` : alert.rule}</td>
                    <td className={`report__tone--${alert.level}`}>{LEVEL_LABELS[alert.level]}</td>
                    <td>{reaction(alert)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-2">Алертов за период не было.</p>
          )}
        </section>
      )}

      {patient.meds && (
        <section className="report__section">
          <h2>Приверженность назначениям</h2>
          {patient.meds.length > 0 ? (
            <table className="report__table">
              <thead>
                <tr>
                  <th scope="col">Препарат</th>
                  <th scope="col">Схема</th>
                  <th scope="col" className="report__num">Приёмов</th>
                  <th scope="col" className="report__num">Приверженность</th>
                </tr>
              </thead>
              <tbody>
                {patient.meds.map((med) => (
                  <tr key={med.name}>
                    <td>{med.name}</td>
                    <td>{med.schedule}</td>
                    <td className="num report__num">{med.taken} / {med.expected}</td>
                    <td className="num report__num">{med.percent !== null ? `${med.percent}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-2">Назначений нет.</p>
          )}
        </section>
      )}

      {patient.messages && (
        <section className="report__section">
          <h2>Переписка с пациентом</h2>
          {patient.messages.length > 0 ? (
            <ol className="report__messages">
              {patient.messages.map((message) => (
                <li key={`${message.createdAt}-${message.body}`}>
                  <span className="report__message-meta">
                    <strong>{message.author}</strong> <span className="num">{formatDayTime(message.createdAt)}</span>
                  </span>
                  <span>{message.body}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-2">Сообщений за период не было.</p>
          )}
        </section>
      )}
    </>
  )
}

function GroupSection({ group }) {
  return (
    <section className="report__section">
      <h2>Сводка по группе: {group.label}</h2>
      <dl className="report__facts report__facts--tight">
        <div><dt>Пациентов</dt><dd className="num">{group.totals.patients}</dd></div>
        <div><dt>Измерений</dt><dd className="num">{group.totals.measurements}</dd></div>
        <div><dt>Алертов</dt><dd className="num">{group.totals.alerts}</dd></div>
        <div>
          <dt>Среднее время реакции</dt>
          <dd className="num">{group.totals.avgResponseMinutes !== null ? `${group.totals.avgResponseMinutes} мин` : '—'}</dd>
        </div>
      </dl>
      <table className="report__table">
        <thead>
          <tr>
            <th scope="col">Пациент</th>
            <th scope="col">Диагноз</th>
            <th scope="col" className="report__num">Измерений</th>
            <th scope="col" className="report__num">Вне цели</th>
            <th scope="col" className="report__num">Алертов</th>
            <th scope="col" className="report__num">Реакция</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.diagnosis}</td>
              <td className="num report__num">{row.measurements}</td>
              <td className="num report__num">
                {row.outOfTarget}{row.outPercent !== null ? ` (${row.outPercent}%)` : ''}
              </td>
              <td className="num report__num">{row.alerts}</td>
              <td className="num report__num">{row.avgResponseMinutes !== null ? `${row.avgResponseMinutes} мин` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ResponseSection({ response }) {
  return (
    <section className="report__section">
      <h2>Реакция на алерты</h2>
      <dl className="report__facts report__facts--tight">
        <div><dt>Всего алертов</dt><dd className="num">{response.summary.total}</dd></div>
        <div><dt>Критических</dt><dd className="num">{response.summary.crit}</dd></div>
        <div><dt>Эскалировано</dt><dd className="num">{response.summary.escalated}</dd></div>
        <div>
          <dt>Среднее время реакции</dt>
          <dd className="num">
            {response.summary.avgResponseMinutes !== null ? `${response.summary.avgResponseMinutes} мин` : '—'}
            {' '}(принято {response.summary.accepted} из {response.summary.total})
          </dd>
        </div>
      </dl>
      {response.rows.length > 0 ? (
        <table className="report__table">
          <thead>
            <tr>
              <th scope="col">Время</th>
              <th scope="col">Пациент</th>
              <th scope="col">Показатель</th>
              <th scope="col">Уровень</th>
              <th scope="col">Реакция</th>
            </tr>
          </thead>
          <tbody>
            {response.rows.map((row) => (
              <tr key={`${row.createdAt}-${row.patientName}-${row.rule}`}>
                <td className="num">{formatDayTime(row.createdAt)}</td>
                <td>{row.patientName}</td>
                <td className="num">{row.value ? `${row.value} ${row.unit}` : row.rule}</td>
                <td className={`report__tone--${row.level}`}>{LEVEL_LABELS[row.level]}</td>
                <td>{reaction(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-2">Алертов за период не было.</p>
      )}
    </section>
  )
}

// Печатная версия отчёта — её же сохраняют в PDF через окно печати
function Report() {
  const { reportId } = useParams()
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getReport(reportId)
      .then((payload) => {
        setReport(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [reportId])

  if (!report) {
    return (
      <main className="report">
        {error ? <FormError>{error}</FormError> : <p className="report__loading text-2">Формируем отчёт…</p>}
      </main>
    )
  }

  return (
    <main className="report">
      <div className="report__actions">
        <Link to="/doctor/reports" className="report__back">← К отчётам</Link>
        <Button size="sm" onClick={() => window.print()}>Печать / Сохранить в PDF</Button>
      </div>

      <article className="report__sheet" aria-labelledby="report-title">
        <header className="report__head">
          <div>
            <span className="report__clinic">{report.doctor.clinic}</span>
            <h1 id="report-title">{report.title}</h1>
          </div>
          <dl className="report__meta">
            <div><dt>Период</dt><dd className="num">{report.periodText}</dd></div>
            <div><dt>Сформирован</dt><dd className="num">{formatDayTime(report.createdAt)}</dd></div>
            <div>
              <dt>Врач</dt>
              <dd>{report.doctor.name}{report.doctor.specialty ? `, ${report.doctor.specialty}` : ''}</dd>
            </div>
          </dl>
        </header>

        {report.kind === 'patient' && <PatientSections patient={report.patient} />}
        {report.kind === 'group' && <GroupSection group={report.group} />}
        {report.kind === 'response' && <ResponseSection response={report.response} />}

        <footer className="report__foot">
          HealthMonitor · платформа не ставит диагноз. Данные обрабатываются на серверах в РФ.
          Выгрузка зафиксирована в журнале аудита.
        </footer>
      </article>
    </main>
  )
}

export default Report
