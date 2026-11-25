import './style.css'

// Вкладки с подчёркиванием. tabs: [{ id, label }]
function TextTabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="text-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="text-tabs__tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default TextTabs
