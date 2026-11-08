import re
from functools import wraps

from flask import g, jsonify, session

from db import db_cursor


def error(message, status=400, **extra):
    return jsonify({'error': message, **extra}), status


def normalize_phone(value):
    """Приводит телефон к виду 7XXXXXXXXXX; None, если это не телефон."""
    digits = re.sub(r'\D', '', value or '')
    if len(digits) == 10:
        digits = '7' + digits
    elif len(digits) == 11 and digits.startswith('8'):
        digits = '7' + digits[1:]
    return digits if len(digits) >= 11 else None


def normalize_email(value):
    value = (value or '').strip().lower()
    return value if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value) else None


def parse_login(raw_login):
    """Логин — телефон или e-mail. Возвращает (phone, email), одно из них None."""
    raw_login = (raw_login or '').strip()
    if '@' in raw_login:
        return None, normalize_email(raw_login)
    return normalize_phone(raw_login), None


def mask_phone(phone):
    """79001231852 → +7 ••• ••• 18 52"""
    return f'+{phone[0]} ••• ••• {phone[-4:-2]} {phone[-2:]}'


def short_name(full_name):
    """Иванова Мария Петровна → Иванова М. П."""
    surname, *rest = full_name.split()
    return ' '.join([surname, *(part[0] + '.' for part in rest)])


def password_problem(password, forbidden=()):
    """Текст ошибки, если пароль не подходит; forbidden — фрагменты, которых в пароле быть не должно."""
    if len(password) < 8:
        return 'Пароль должен быть не короче 8 символов.'
    if not re.search(r'[A-Za-zА-Яа-яЁё]', password) or not re.search(r'\d', password):
        return 'В пароле нужны буквы и хотя бы одна цифра.'
    lowered = password.lower()
    if any(fragment and fragment.lower() in lowered for fragment in forbidden):
        return 'Пароль не должен содержать телефон, e-mail или год рождения.'
    return None


def start_session(user):
    session.clear()
    session.permanent = True
    session['user_id'] = user['id']
    session['role'] = user['role']
    session['version'] = user['session_version']


def current_user():
    """Пользователь текущего сеанса или None. Сеанс недействителен после смены пароля или блокировки."""
    if 'user' in g:
        return g.user
    user = None
    user_id = session.get('user_id')
    if user_id:
        with db_cursor() as cur:
            cur.execute('SELECT * FROM users WHERE id = %s', (user_id,))
            user = cur.fetchone()
        if not user or user['is_blocked'] or user['session_version'] != session.get('version'):
            session.clear()
            user = None
    g.user = user
    return user


def login_required(*roles):
    """Декоратор: нужен вход, а если указаны роли — одна из них."""
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return error('Требуется вход.', 401)
            if roles and user['role'] not in roles:
                return error('Недостаточно прав.', 403)
            return view(*args, **kwargs)
        return wrapper
    return decorator
