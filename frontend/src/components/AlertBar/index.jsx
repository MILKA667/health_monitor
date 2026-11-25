import { useId } from 'react'
import Button from '../Button'
import '../Field/style.css'
import './style.css'

// Полоса критического алерта. Пока алерт не принят — поле комментария и «Принять алерт»,
// после принятия — нейтральная полоса с «Отменить».
function AlertBar({ title, text, accepted, comment, onCommentChange, onAccept, onUndo, disabled }) {
  const commentId = useId()

  return (
    <div className={`alert-bar${accepted ? ' alert-bar--accepted' : ''}`}>
      <div className="alert-bar__text">
        <span className="alert-bar__title">{title}</span>
        <span>{text}</span>
      </div>

      {accepted ? (
        <Button size="sm" onClick={onUndo} disabled={disabled}>Отменить</Button>
      ) : (
        <>
          {onCommentChange && (
            <div className="alert-bar__comment">
              <label htmlFor={commentId} className="vh">Комментарий к принятию алерта</label>
              <input
                id={commentId}
                className="field__control field__control--sm"
                placeholder="Комментарий (необязательно)"
                value={comment}
                onChange={(e) => onCommentChange(e.target.value)}
              />
            </div>
          )}
          <Button variant="danger" size="sm" onClick={onAccept} disabled={disabled}>Принять алерт</Button>
        </>
      )}
    </div>
  )
}

export default AlertBar
