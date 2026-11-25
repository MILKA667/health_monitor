import { formatDay } from '../../utils/format'
import './style.css'

const WIDTH = 760
const HEIGHT = 240
const LEFT = 44
const RIGHT = 12
const TOP = 14
const BOTTOM = 24

// Линейный график показателя: полоса цели, пунктирные пороги и точки вне цели.
// chart — данные с сервера: { series, bands, guides, domain, yTicks, firstDate, lastDate }.
function Chart({ chart, label }) {
  const points = (chart?.series ?? []).flatMap((series) => series.points)

  if (!chart || points.length === 0) {
    return <p className="chart__empty text-2">За выбранный период измерений нет.</p>
  }

  const [min, max] = chart.domain
  const count = Math.max(...chart.series.map((series) => series.points.length))
  const x = (index) =>
    count === 1 ? LEFT + (WIDTH - LEFT - RIGHT) / 2 : LEFT + (index * (WIDTH - LEFT - RIGHT)) / (count - 1)
  const y = (value) => TOP + ((max - value) / (max - min)) * (HEIGHT - TOP - BOTTOM)

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
        <title>{label}</title>

        {chart.bands.map((band) => (
          <rect
            key={`band-${band.from}`}
            className="chart__band"
            x={LEFT}
            y={y(band.to)}
            width={WIDTH - LEFT - RIGHT}
            height={Math.max(0, y(band.from) - y(band.to))}
          />
        ))}

        {chart.yTicks.map((tick) => (
          <g key={`tick-${tick.value}`}>
            <line className="chart__grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick.value)} y2={y(tick.value)} />
            <text className="chart__tick" x={LEFT - 8} y={y(tick.value) + 4} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}

        {chart.guides
          .filter((guide) => guide.value !== null)
          .map((guide) => (
            <g key={`guide-${guide.value}`}>
              <line
                className={`chart__guide chart__guide--${guide.tone}`}
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={y(guide.value)}
                y2={y(guide.value)}
              />
              {guide.label && (
                <text
                  className={`chart__guide-label chart__guide-label--${guide.tone}`}
                  x={WIDTH - RIGHT - 4}
                  y={y(guide.value) - 4}
                  textAnchor="end"
                >
                  {guide.label}
                </text>
              )}
            </g>
          ))}

        {chart.series.map((series) => (
          <g key={series.id}>
            {series.points.length > 1 && (
              <polyline
                className="chart__line"
                points={series.points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')}
              />
            )}
            {series.points.map((point, index) => (
              <circle
                key={point.date}
                className={`chart__dot chart__dot--${point.level}`}
                cx={x(index)}
                cy={y(point.value)}
                r="3"
              />
            ))}
          </g>
        ))}

        <text className="chart__x" x={LEFT} y={HEIGHT - 6}>
          {formatDay(chart.firstDate)}
        </text>
        <text className="chart__x" x={WIDTH - RIGHT} y={HEIGHT - 6} textAnchor="end">
          {formatDay(chart.lastDate)}
        </text>
      </svg>
    </div>
  )
}

export default Chart
