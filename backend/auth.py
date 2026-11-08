import hashlib
import secrets

import psycopg2
from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import audit, db_cursor
from security import (current_user, error, login_required, mask_phone, normalize_email, normalize_phone,
                      parse_login, password_problem, start_session)
from sms import send_sms

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

APPLICATION_ROLES = ('patient', 'relative', 'doctor')

# Не больше 5 неудачных попыток входа с одного IP за 15 минут
MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW = '15 minutes'

CODE_ATTEMPTS = 3
CODE_LIFETIME = '10 minutes'
CODE_RESEND_SECONDS = 60
RESET_TOKEN_LIFETIME = '15 minutes'

# Хэш для несуществующего логина, чтобы время ответа не выдавало, есть ли учётка
DUMMY_HASH = generate_password_hash('dummy-password')


def find_user(cur, raw_login):
    phone, email = parse_login(raw_login)
    if not phone and not email:
        return None
    cur.execute('SELECT * FROM users WHERE email = %s OR phone = %s', (email, phone))
    return cur.fetchone()


def set_password(cur, user_id, password):
    """Новый пароль завершает все прежние сеансы."""
    cur.execute(
        """UPDATE users SET password_hash = %s, must_change_password = FALSE,
                  session_version = session_version + 1, password_changed_at = now()
           WHERE id = %s RETURNING *""",
        (generate_password_hash(password), user_id),
    )
    return cur.fetchone()


@bp.post('/login')
def login():
    data = request.get_json(silent=True) or {}
    raw_login = str(data.get('login', '')).strip()
    password = str(data.get('password', ''))
    if not raw_login or not password:
        return error('Введите телефон или e-mail и пароль.')

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

        user = find_user(cur, raw_login)

        if not check_password_hash(user['password_hash'] if user else DUMMY_HASH, password):
            audit(cur, 'login_failed', user['id'] if user else None, raw_login, ip, is_security=True)
            return error('Неверный телефон, e-mail или пароль.', 401)

        if user['is_blocked']:
            audit(cur, 'login_blocked', user['id'], raw_login, ip, is_security=True)
            return error('Учётная запись заблокирована. Обратитесь в клинику.', 403)

        audit(cur, 'login', user['id'], None, ip)

    start_session(user)
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
@login_required()
def me():
    user = current_user()
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


@bp.post('/recover/code')
def recover_code():
    data = request.get_json(silent=True) or {}
    raw_login = str(data.get('login', '')).strip()
    ip = request.remote_addr

    with db_cursor() as cur:
        user = find_user(cur, raw_login)
        if not user or user['is_blocked']:
            audit(cur, 'recover_unknown', None, raw_login, ip, is_security=True)
            return error('Не нашли учётную запись с таким телефоном или e-mail.', 404)
        if not user['phone']:
            return error('К учётной записи не привязан телефон. Восстановить вход может администратор клиники.', 400)

        cur.execute(
            """SELECT extract(epoch FROM now() - created_at) AS age FROM recovery_codes
               WHERE user_id = %s ORDER BY created_at DESC LIMIT 1""",
            (user['id'],),
        )
        last = cur.fetchone()
        if last and last['age'] < CODE_RESEND_SECONDS:
            return error('Код уже отправлен. Повторно можно запросить через минуту.', 429)

        code = f'{secrets.randbelow(10 ** 6):06d}'
        cur.execute('UPDATE recovery_codes SET used = TRUE WHERE user_id = %s AND NOT used', (user['id'],))
        cur.execute(
            """INSERT INTO recovery_codes (user_id, code_hash, expires_at)
               VALUES (%s, %s, now() + %s::interval)""",
            (user['id'], generate_password_hash(code), CODE_LIFETIME),
        )
        send_sms(cur, user['phone'], f'HealthMonitor: код для смены пароля {code}. Никому его не сообщайте.')
        audit(cur, 'recover_code_sent', user['id'], None, ip, is_security=True)

    return jsonify({'masked': mask_phone(user['phone'])})


@bp.post('/recover/verify')
def recover_verify():
    data = request.get_json(silent=True) or {}
    raw_login = str(data.get('login', '')).strip()
    code = str(data.get('code', '')).strip()
    ip = request.remote_addr

    with db_cursor() as cur:
        user = find_user(cur, raw_login)
        cur.execute(
            """SELECT * FROM recovery_codes
               WHERE user_id = %s AND NOT used AND expires_at > now()
               ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
            (user['id'] if user else None,),
        )
        record = cur.fetchone()
        if not record:
            return error('Код устарел. Запросите новый.', 400, attemptsLeft=0)
        if record['attempts'] >= CODE_ATTEMPTS:
            return error('Слишком много неверных попыток. Запросите новый код.', 400, attemptsLeft=0)

        if not check_password_hash(record['code_hash'], code):
            cur.execute('UPDATE recovery_codes SET attempts = attempts + 1 WHERE id = %s', (record['id'],))
            audit(cur, 'recover_code_failed', user['id'], None, ip, is_security=True)
            attempts_left = CODE_ATTEMPTS - record['attempts'] - 1
            return error('Неверный код.', 400, attemptsLeft=attempts_left)

        token = secrets.token_urlsafe(32)
        cur.execute('UPDATE recovery_codes SET used = TRUE WHERE id = %s', (record['id'],))
        cur.execute('DELETE FROM reset_tokens WHERE user_id = %s', (user['id'],))
        cur.execute(
            'INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (%s, %s, now() + %s::interval)',
            (hashlib.sha256(token.encode()).hexdigest(), user['id'], RESET_TOKEN_LIFETIME),
        )
        audit(cur, 'recover_code_ok', user['id'], None, ip, is_security=True)

    return jsonify({'token': token})


@bp.post('/recover/reset')
def recover_reset():
    data = request.get_json(silent=True) or {}
    token = str(data.get('token', ''))
    password = str(data.get('password', ''))

    with db_cursor() as cur:
        cur.execute(
            """DELETE FROM reset_tokens WHERE token_hash = %s AND expires_at > now()
               RETURNING user_id""",
            (hashlib.sha256(token.encode()).hexdigest(),),
        )
        row = cur.fetchone()
        if not row:
            return error('Время на смену пароля истекло. Начните восстановление заново.', 400)

        cur.execute('SELECT * FROM users WHERE id = %s', (row['user_id'],))
        user = cur.fetchone()
        problem = password_problem(password, (user['phone'], user['phone'] and user['phone'][1:], user['email']))
        if problem:
            # Токен возвращаем: ошибку в пароле можно исправить без нового кода
            cur.connection.rollback()
            return error(problem)

        set_password(cur, user['id'], password)
        if user['phone']:
            send_sms(cur, user['phone'], 'HealthMonitor: пароль изменён. Если это были не вы, позвоните в клинику.')
        audit(cur, 'password_reset', user['id'], None, request.remote_addr, is_security=True)

    session.clear()
    return jsonify({'ok': True})


def create_user(role, name, password, phone=None, email=None, temporary=False):
    """Создаёт учётную запись; используется CLI-командами и позже — одобрением заявки."""
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
