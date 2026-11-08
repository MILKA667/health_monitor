import { useId } from 'react'
import StatusMarker from '../StatusMarker'
import './style.css'

// Сворачиваемая группа рабочего списка: заголовок-кнопка с маркером статуса и счётчиком
function WorklistGroup({ level, label, count, open, onToggle, children }) {
  const bodyId = useId()

  return (
    <div className="worklist-group">
      <button
        type="button"
        className="worklist-group__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="worklist-group__chev">
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <StatusMarker level={level} withLabel />
        {label}
        <span className="num worklist-group__count">{count}</span>
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export default WorklistGroup
