import { useEffect, useState } from 'react'
import { getHistory } from '../../api/patient'
import Chart from '../../components/Chart'
import FormError from '../../components/FormError'
import { formatDayTime } from '../../utils/format'
import '../../components/Field/style.css'
import './style.css'

const PERIODS = [7, 14]

// История измерений: выбор периода, график с целью и таблица замеров
function PatientHistory() {
  const [days, setDays] = useState(14)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getHistory(days)
      .then((payload) => {
        setData(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [days])

  if (!data) {
    return (
      <div className="patient-page history">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем историю…</p>}
      </div>
    )
  }

  const outOfTarget = data.stats.find((stat) => stat.label === 'Вне цели')?.value
  const average = data.stats.find((stat) => stat.label === 'Среднее')?.value

  return (
    <div className="patient-page history">
      <h1>История измерений</h1>
      <FormError>{error}</FormError>

      <div className="history__filters">
        <label className="history__field">
          <span className="history__label">Показатель</span>
          <select className="field__control field__control--lg" value={data.kind} disabled>
            <option>{data.kindTitle}</option>
          </select>
        </label>
        <label className="history__field">
          <span className="history__label">Период</span>
          <select
            className="field__control field__control--lg"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PERIODS.map((value) => (
              <option key={value} value={value}>{value} дней</option>
            ))}
          </select>
        </label>
      </div>

      <section className="patient-section" aria-labelledby="history-chart">
        <h2 id="history-chart" className="vh">График</h2>
        <div className="history__stats">
          {average && <span>Среднее <span className="num">{average}</span></span>}
          {outOfTarget && <span>Вне цели <span className="num">{outOfTarget}</span></span>}
        </div>
        <Chart
          chart={data.chart}
          label={`${data.kindTitle} за ${days} дней, вне цели ${outOfTarget ?? '0'}`}
        />
        {data.chart.series.some((series) => series.label) && (
          <div className="history__legend">
            {data.chart.series.map((series, index) => (
              <span key={series.id} className="history__legend-item">
                <span className={`history__legend-line history__legend-line--${index}`} aria-hidden="true" />
                {series.label}
              </span>
            ))}
          </div>
        )}
        <p className="patient-hint">
          Серая полоса — цель, пунктир — критический порог. Красные точки — значения вне цели.
        </p>
      </section>

      <section className="patient-section" aria-labelledby="history-rows">
        <h2 id="history-rows">Измерения</h2>
        {data.measurements.length > 0 ? (
          <table className="history__table">
            <caption className="vh">{data.kindTitle}, {data.measurements[0]?.unit}</caption>
            <tbody>
              {data.measurements.map((measurement) => (
                <tr key={measurement.id}>
                  <td className="num history__when">{formatDayTime(measurement.measuredAt)}</td>
                  <td className={`num history__value history__value--${measurement.level}`}>{measurement.value}</td>
                  <td className="history__context">{measurement.context || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="patient-hint">Измерений за период нет.</p>
        )}
      </section>
    </div>
  )
}

export default PatientHistory
