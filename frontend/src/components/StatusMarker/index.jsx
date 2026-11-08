import './style.css'

const LABELS = {
  crit: 'Критично',
  warn: 'Внимание',
  none: 'Нет данных',
}

// Маркер статуса: точка (crit, warn) или пустой кружок (none); норма без маркера.
// Если рядом нет видимой подписи статуса, он дублируется скрытым текстом.
function StatusMarker({ level, withLabel = false }) {
  if (!LABELS[level]) return null

  return (
    <span className={`status-marker status-marker--${level}`}>
      {!withLabel && <span className="vh">{LABELS[level]}</span>}
    </span>
  )
}

export default StatusMarker
