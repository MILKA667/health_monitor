import './style.css'

// Значение показателя моноширинным шрифтом; цвет по уровню (crit, warn), единицы серым
function ValueCell({ value, unit, level }) {
  return (
    <span className="value-cell">
      <span className={`num value-cell__value${level ? ` value-cell__value--${level}` : ''}`}>{value}</span>
      {unit && <span className="value-cell__unit"> {unit}</span>}
    </span>
  )
}

export default ValueCell
