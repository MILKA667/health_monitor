import './style.css'

// Переключатель вариантов, например 7/14/30 дней. options: [{ value, label }]
function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className="segmented__item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default SegmentedControl
