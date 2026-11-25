import { Link } from 'react-router'
import './style.css'

// variant: primary | secondary | danger; size: sm (врач, админ) | md (вход) | lg (пациент)
function Button({ variant = 'secondary', size = 'md', to, className = '', ...props }) {
  const classes = `btn btn--${variant} btn--${size} ${className}`.trim()

  if (to) {
    return <Link to={to} className={classes} {...props} />
  }

  return <button type="button" className={classes} {...props} />
}

export default Button
