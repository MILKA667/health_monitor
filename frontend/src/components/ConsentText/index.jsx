import './style.css'

// Прокручиваемый текст согласия на обработку данных
function ConsentText({ maxHeight = 200, children }) {
  return (
    <section aria-label="Текст согласия" className="consent-text" style={{ maxHeight }} tabIndex={0}>
      {children}
      <span className="consent-text__todo">[Полный юридический текст согласия — готовит юридический отдел]</span>
    </section>
  )
}

export default ConsentText
