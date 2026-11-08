import re

import psycopg2
from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import audit, db_cursor

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

APPLICATION_ROLES = ('patient', 'relative', 'doctor')

# Не больше 5 неудачных попыток входа с одного IP за 15 минут
MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW = '15 minutes'

# Хэш для несуществующего логина, чтобы время ответа не выдавало, есть ли учётка
DUMMY_HASH = generate_password_hash('dummy-password')


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


def error(message, status=400):
    return jsonify({'error': message}), status


@bp.post('/login')
def login():
    data = request.get_json(silent=True) or {}
    raw_login = str(data.get('login', '')).strip()
    password = str(data.get('password', ''))
    if not raw_login or not password:
        return error('Введите телефон или e-mail и пароль.')

    email = normalize_email(raw_login) if '@' in raw_login else None
    phone = None if email else normalize_phone(raw_login)
    ip = request.remote_addr

    with db_cursor() as cur:
        cur.execute(
            """SELECT count(*) AS n FROM audit_log
               WHERE action = 'login_failed' AND ip = %s
                 AND created_at > now() - %s::interval""",
            (ip, FAILED_LOGIN_WINDOW),
        )
        if cur.fetchone()['n'] >= MAX_FAILED_LOGINS:
            return error('Слишком много попыток входа. Попробуйте через 15 минут или восстановите пароль.', 429)

        user = None
        if email or phone:
            cur.execute(
                'SELECT * FROM users WHERE email = %s OR phone = %s',
                (email, phone),
            )
            user = cur.fetchone()

        if not check_password_hash(user['password_hash'] if user else DUMMY_HASH, password):
            audit(cur, 'login_failed', user['id'] if user else None, raw_login, ip, is_security=True)
            return error('Неверный телефон, e-mail или пароль.', 401)

        if user['is_blocked']:
            audit(cur, 'login_blocked', user['id'], raw_login, ip, is_security=True)
            return error('Учётная запись заблокирована. Обратитесь в клинику.', 403)

        audit(cur, 'login', user['id'], None, ip)

    session.clear()
    session.permanent = True
    session['user_id'] = user['id']
    session['role'] = user['role']
    return jsonify({'role': user['role'], 'mustChangePassword': user['must_change_password']})


@bp.post('/logout')
def logout():
    user_id = session.get('user_id')
    if user_id:
        with db_cursor() as cur:
            audit(cur, 'logout', user_id, None, request.remote_addr)
    session.clear()
    return jsonify({'ok': True})


@bp.get('/me')
def me():
    user_id = session.get('user_id')
    if not user_id:
        return error('Требуется вход.', 401)
    with db_cursor() as cur:
        cur.execute('SELECT id, role, name, must_change_password, is_blocked FROM users WHERE id = %s', (user_id,))
        user = cur.fetchone()
    if not user or user['is_blocked']:
        session.clear()
        return error('Требуется вход.', 401)
    return jsonify({
        'id': user['id'],
        'role': user['role'],
        'name': user['name'],
        'mustChangePassword': user['must_change_password'],
    })


@bp.post('/register')
def register():
    """Заявка на доступ. Учётную запись создаёт администратор после одобрения."""
    data = request.get_json(silent=True) or {}
    role = data.get('role')
    name = str(data.get('name', '')).strip()
    phone = normalize_phone(str(data.get('phone', '')))
    raw_email = str(data.get('email', '')).strip()
    email = normalize_email(raw_email)
    extra = str(data.get('extra', '')).strip() if role != 'patient' else ''
    consents = data.get('consents') or {}

    if role not in APPLICATION_ROLES:
        return error('Выберите, кто вы: пациент, родственник или врач.')
    if len(name) <= 4:
        return error('Укажите ФИО полностью.')
    if not phone:
        return error('Укажите телефон в формате +7 900 000-00-00.')
    if raw_email and not email:
        return error('Проверьте e-mail или оставьте поле пустым.')
    if role != 'patient' and len(extra) <= 3:
        return error('Укажите ФИО пациента.' if role == 'relative' else 'Укажите специальность и место работы.')
    if consents.get('personalData') is not True or consents.get('noDiagnosis') is not True:
        return error('Без обоих согласий заявку отправить нельзя.')

    with db_cursor() as cur:
        cur.execute('SELECT 1 FROM users WHERE phone = %s OR email = %s', (phone, email))
        if cur.fetchone():
            return error('С этим телефоном или e-mail уже есть учётная запись. Войдите или восстановите пароль.', 409)

        cur.execute("SELECT 1 FROM applications WHERE phone = %s AND status = 'pending'", (phone,))
        if cur.fetchone():
            return error('Заявка с этим телефоном уже на рассмотрении. Дождитесь SMS от администратора.', 409)

        cur.execute(
            """INSERT INTO applications (role, name, phone, email, extra, consent_personal_data, consent_no_diagnosis)
               VALUES (%s, %s, %s, %s, %s, TRUE, TRUE) RETURNING id""",
            (role, name, phone, email, extra),
        )
        application_id = cur.fetchone()['id']
        audit(cur, 'application_submitted', None, f'application:{application_id}', request.remote_addr)

    return jsonify({'id': application_id, 'status': 'pending'}), 201


def create_user(role, name, password, phone=None, email=None, temporary=False):
    """Создаёт учётную запись; используется CLI-командой и позже — одобрением заявки."""
    with db_cursor() as cur:
        try:
            cur.execute(
                """INSERT INTO users (role, name, phone, email, password_hash, must_change_password)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (role, name, normalize_phone(phone) if phone else None,
                 normalize_email(email) if email else None,
                 generate_password_hash(password), temporary),
            )
        except psycopg2.errors.UniqueViolation:
            raise ValueError('Пользователь с таким телефоном или e-mail уже существует')
        user_id = cur.fetchone()['id']
        audit(cur, 'user_created', None, f'user:{user_id}')
    return user_id
