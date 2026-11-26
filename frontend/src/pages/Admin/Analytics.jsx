import { useEffect, useState } from 'react'
import { getAnalytics } from '../../api/admin'
import FormError from '../../components/FormError'
import { formatDate } from '../../utils/format'
import './analytics.css'

const PERIODS = [7, 14, 30, 90]

function percent(value) {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value * 100)}%`
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className={`metric${tone ? ` metric--${tone}` : ''}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value num">{value}</span>
      {hint ? <span className="metric__hint">{hint}</span> : null}
    </div>
  )
}

// Столбики по дням: высота пропорциональна значению
function Bars({ items, valueKey, label }) {
  const peak = Math.max(1, ...items.map((item) => item[valueKey] ?? 0))
  return (
    <div className="bars" role="img" aria-label={label}>
      {items.map((item) => (
        <div className="bars__col" key={item.date} title={`${formatDate(item.date)}: ${item[valueKey] ?? 0}`}>
          <span
            className="bars__bar"
            style={{ height: `${Math.max(2, ((item[valueKey] ?? 0) / peak) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function Funnel({ funnel }) {
  const steps = [
    { label: 'Заявки', value: funnel.submitted, rate: null },
    { label: 'Одобрены', value: funnel.approved, rate: funnel.rates.approved },
    { label: 'Вошли', value: funnel.loggedIn, rate: funnel.rates.loggedIn },
    { label: 'Ввели показатель', value: funnel.measured, rate: funnel.rates.measured },
  ]
  const peak = Math.max(1, ...steps.map((step) => step.value))
  return (
    <div className="funnel">
      {steps.map((step) => (
        <div className="funnel__row" key={step.label}>
          <span className="funnel__label">{step.label}</span>
          <span className="funnel__track">
            <span className="funnel__fill" style={{ width: `${(step.value / peak) * 100}%` }} />
          </span>
          <span className="funnel__value num">{step.value}</span>
          <span className="funnel__rate num">{step.rate === null ? '' : percent(step.rate)}</span>
        </div>
      ))}
    </div>
  )
}

// Дашборд метрик продукта: вовлечённость, воронка, алерты, качество
function Analytics() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAnalytics(days)
      .then((payload) => {
        if (active) {
          setData(payload)
          setError('')
        }
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
    return () => { active = false }
  }, [days])

  return (
    <section className="analytics" aria-label="Аналитика продукта">
      <div className="analytics__toolbar">
        <div className="analytics__periods" role="group" aria-label="Период">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              className={`analytics__period${value === days ? ' analytics__period--active' : ''}`}
              onClick={() => setDays(value)}
            >
              {value} дней
            </button>
          ))}
        </div>
        {data && <span className="analytics__updated">Данные за последние {data.period.days} дней</span>}
      </div>

      <FormError>{error}</FormError>

      {!data && !error && <p className="analytics__empty text-2">Загружаем метрики…</p>}

      {data && (
        <>
          <section className="panel analytics__section" aria-label="Вовлечённость">
            <h2 className="analytics__title">Вовлечённость</h2>
            <div className="metrics">
              <Metric label="DAU" value={data.engagement.dau} hint="за 24 часа" />
              <Metric label="WAU" value={data.engagement.wau} hint="за 7 дней" />
              <Metric label="MAU" value={data.engagement.mau} hint="за 30 дней" />
              <Metric label="Stickiness" value={percent(data.engagement.stickiness)} hint="DAU / MAU" />
              <Metric label="Возвращаются" value={percent(data.engagement.returning)} hint="2+ дня за период" />
              <Metric label="Новые" value={data.engagement.newUsers} hint="регистрации за период" />
            </div>
            <div className="analytics__chart">
              <div className="analytics__chart-head">
                <span>Активные пользователи по дням</span>
                <span className="analytics__chart-range">
                  {formatDate(data.engagement.daily[0]?.date)} — {formatDate(data.engagement.daily.at(-1)?.date)}
                </span>
              </div>
              <Bars items={data.engagement.daily} valueKey="active" label="Активные пользователи по дням" />
            </div>
            <div className="retention">
              <span>Удержание:</span>
              <span>D1 <b className="num">{percent(data.engagement.retention.d1)}</b></span>
              <span>D7 <b className="num">{percent(data.engagement.retention.d7)}</b></span>
              <span>D30 <b className="num">{percent(data.engagement.retention.d30)}</b></span>
            </div>
          </section>

          <section className="panel analytics__section" aria-label="Воронка конверсии">
            <h2 className="analytics__title">Воронка пациентов</h2>
            <Funnel funnel={data.funnel} />
            <p className="analytics__note">
              Заявка → одобрение → первый вход → первый показатель. Проценты — к предыдущему шагу.
            </p>
          </section>

          <section className="panel analytics__section" aria-label="Алерты">
            <h2 className="analytics__title">Алерты</h2>
            <div className="metrics">
              <Metric label="Всего" value={data.alerts.total} />
              <Metric label="Критические" value={data.alerts.crit} tone="crit" />
              <Metric label="Внимание" value={data.alerts.warn} />
              <Metric label="Нет данных" value={data.alerts.nodata} />
              <Metric label="Приняты" value={percent(data.alerts.acceptanceRate)} hint={`${data.alerts.accepted} из ${data.alerts.total}`} />
              <Metric label="Медиана реакции" value={data.alerts.medianMinutes === null ? '—' : `${data.alerts.medianMinutes} мин`} />
              <Metric label="Приняты за 15 мин" value={percent(data.alerts.within15Rate)} />
            </div>
            <div className="analytics__chart">
              <div className="analytics__chart-head">
                <span>Создано алертов по дням</span>
                <span className="analytics__chart-range">
                  {formatDate(data.alerts.daily[0]?.date)} — {formatDate(data.alerts.daily.at(-1)?.date)}
                </span>
              </div>
              <Bars items={data.alerts.daily} valueKey="created" label="Создано алертов по дням" />
            </div>
          </section>

          <section className="panel analytics__section" aria-label="Клинические показатели">
            <h2 className="analytics__title">Клинические показатели</h2>
            <div className="metrics">
              <Metric label="Измерения" value={data.clinical.measurements} hint="за период" />
              <Metric label="Глюкоза" value={data.clinical.byKind.glucose} />
              <Metric label="Давление" value={data.clinical.byKind.bp} />
              <Metric label="ПСВ" value={data.clinical.byKind.pef} />
              <Metric label="Активные пациенты" value={data.clinical.activePatients} />
              <Metric label="Без данных 2+ дня" value={data.clinical.withoutData} tone="crit" />
              <Metric label="Приверженность" value={percent(data.clinical.adherence)} hint="приёмы лекарств" />
            </div>
          </section>

          <section className="panel analytics__section" aria-label="Качество">
            <h2 className="analytics__title">Качество</h2>
            <div className="metrics">
              <Metric label="NPS" value="—" hint="опросы не подключены" />
              <Metric label="CSAT" value="—" hint="опросы не подключены" />
              <Metric label="CES" value="—" hint="опросы не подключены" />
            </div>
            <p className="analytics__note">
              NPS, CSAT и CES появятся после подключения опросов. Монетизация не отображается:
              в продукте пока нет биллинга.
            </p>
          </section>
        </>
      )}
    </section>
  )
}

export default Analytics
