import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createReport, getReports } from '../../api/doctor'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDate, formatDay, formatDayTime, plural } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const TYPE_HINTS = {
  patient: 'динамика показателей, алерты, приверженность',
  group: 'сводка по нозологии: регулярность ввода, доля вне цели',
  response: 'время реакции врачей отделения, эскалации',
}

function periodLabel(days) {
  const end = new Date()
  const start = new Date(Date.now() - (days - 1) * 86400000)
  const length = days === 90 ? '3 месяца' : `${days} ${plural(days, 'день', 'дня', 'дней')}`
  return `${formatDay(start.toISOString())}–${formatDate(end.toISOString())} (${length})`
}

// Отчёты: форма слева, сформированные отчёты справа
function Reports() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [kind, setKind] = useState('patient')
  const [days, setDays] = useState(14)
  const [patientId, setPatientId] = useState(null)
  const [nosology, setNosology] = useState('all')
  const [sections, setSections] = useState({ dynamics: true, alerts: true, meds: true, messages: false })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    getReports()
      .then((payload) => {
        setData(payload)
        setPatientId((current) => current ?? payload.options.patients[0]?.id ?? null)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const chosen = useMemo(
    () => (data ? data.options.sections.filter((section) => sections[section.id]) : []),
    [data, sections],
  )

  if (!data) {
    return (
      <main>
        {error ? <div className="reports-body"><FormError>{error}</FormError></div> : <p className="reports__loading text-2">Загружаем отчёты…</p>}
      </main>
    )
  }

  const kindLabel = data.options.kinds.find((item) => item.id === kind)?.label ?? ''
  const subject = kind === 'patient'
    ? data.options.patients.find((item) => item.id === patientId)?.label ?? '—'
    : kind === 'group'
      ? data.options.nosologies.find((item) => item.id === nosology)?.label ?? 'все нозологии'
      : 'отделение'
  const summary = chosen.length
    ? `${kindLabel} · ${subject}, ${periodLabel(days)}: ${chosen.map((section) => section.label.toLowerCase()).join(', ')}`
    : 'Выберите хотя бы один раздел'
  const canCreate = chosen.length > 0 && (kind !== 'patient' || patientId) && !pending

  async function handleCreate() {
    if (!canCreate) return
    setPending(true)
    setError('')
    try {
      const report = await createReport({
        kind,
        days,
        patientId: kind === 'patient' ? patientId : undefined,
        nosology: kind === 'group' ? nosology : undefined,
        sections: chosen.map((section) => section.id),
      })
      navigate(`/doctor/reports/${report.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main>
      <div className="reports-head">
        <h1>Отчёты</h1>
      </div>

      <div className="reports-body">
        <FormError>{error}</FormError>
        <div className="reports__layout">
          <section className="panel reports__form" aria-labelledby="reports-form-title">
            <h2 id="reports-form-title">Новый отчёт</h2>

            <fieldset className="reports__group">
              <legend className="reports__label">Тип</legend>
              {data.options.kinds.map((option) => (
                <label key={option.id} className="reports__check">
                  <input
                    type="radio"
                    name="report-kind"
                    checked={kind === option.id}
                    onChange={() => setKind(option.id)}
                  />
                  <span className="reports__check-text">
                    <span>{option.label}</span>
                    <span className="hint">{TYPE_HINTS[option.id]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="reports__field">
              <span className="reports__label">Период</span>
              <select className="field__control field__control--sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {data.options.periods.map((value) => (
                  <option key={value} value={value}>{periodLabel(value)}</option>
                ))}
              </select>
            </label>

            {kind === 'patient' && (
              <label className="reports__field">
                <span className="reports__label">Пациент</span>
                <select
                  className="field__control field__control--sm"
                  value={patientId ?? ''}
                  onChange={(e) => setPatientId(Number(e.target.value))}
                  disabled={data.options.patients.length === 0}
                >
                  {data.options.patients.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}

            {kind === 'group' && (
              <label className="reports__field">
                <span className="reports__label">Нозология</span>
                <select className="field__control field__control--sm" value={nosology} onChange={(e) => setNosology(e.target.value)}>
                  {data.options.nosologies.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}

            <fieldset className="reports__group">
              <legend className="reports__label">Разделы</legend>
              {data.options.sections.map((section) => (
                <label key={section.id} className="reports__check">
                  <input
                    type="checkbox"
                    checked={Boolean(sections[section.id])}
                    onChange={(e) => setSections({ ...sections, [section.id]: e.target.checked })}
                  />
                  {section.label}
                </label>
              ))}
            </fieldset>

            <div className="reports__actions">
              <Button variant="primary" onClick={handleCreate} disabled={!canCreate}>Сформировать PDF</Button>
              <span className="reports__hint hint">{summary}. Выгрузка фиксируется в журнале аудита.</span>
            </div>
          </section>

          <section className="panel reports__ready" aria-labelledby="reports-ready-title">
            <h2 id="reports-ready-title">Сформированные</h2>
            <div className="reports__scroll">
              {data.reports.length === 0 ? (
                <p className="reports__empty text-2">Отчётов пока нет.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Отчёт</th>
                      <th scope="col">Период</th>
                      <th scope="col">Разделы</th>
                      <th scope="col">Создан</th>
                      <th scope="col"><span className="vh">Файл</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map((report) => (
                      <tr key={report.id}>
                        <td className="reports__name">
                          <Link to={`/doctor/reports/${report.id}`}>{report.title}</Link>
                        </td>
                        <td className="num text-2">{report.periodText}</td>
                        <td className="text-2">{report.sections.map((section) => section.label.toLowerCase()).join(', ')}</td>
                        <td className="num text-2">{formatDayTime(report.createdAt)}</td>
                        <td className="reports__file">
                          <Link to={`/doctor/reports/${report.id}`}>PDF</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default Reports
