import './style.css'

// Полоса прогресса из сегментов; пройденные и текущий шаг — синие
function StepProgress({ step, total = 3 }) {
  return (
    <ol className="step-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className={i < step ? 'step-progress__done' : undefined} />
      ))}
    </ol>
  )
}

export default StepProgress
