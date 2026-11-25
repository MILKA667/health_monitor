import './style.css'

// Рамка-панель для самостоятельного объекта: таблицы, сводки, формы
function Panel({ as: Tag = 'section', className = '', ...props }) {
  return <Tag className={`panel ${className}`.trim()} {...props} />
}

export default Panel
