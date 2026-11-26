"""Админка: заявки на доступ, пользователи и журнал аудита."""
import secrets
import string
from datetime import date

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from db import audit, db_cursor
from notifications import notify
from security import current_user, error, login_required, mask_phone, short_name

bp = Blueprint('admin', __name__, url_prefix='/api/admin')

ROLE_LABELS = {'doctor': 'Врач', 'patient': 'Пациент', 'relative': 'Родственник', 'admin': 'Администратор'}
NOSOLOGIES = {'diabetes': 'Сахарный диабет', 'hypertension': 'Гипертония', 'asthma': 'Астма'}
SEXES = {'м': 'мужской', 'ж': 'женский'}

ACTION_LABELS = {
    'login': 'Вход',
    'logout': 'Выход',
    'login_failed': 'Неудачная попытка входа',
    'login_blocked': 'Попытка входа в заблокированную запись',
    'user_created': 'Создана учётная запись',
    'user_blocked': 'Учётная запись заблокирована',
    'user_unblocked': 'Учётная запись разблокирована',
    'user_deleted': 'Учётная запись удалена',
    'password_reset_by_admin': 'Пароль сброшен администратором',
    'application_submitted': 'Подана заявка на доступ',
    'applications_viewed': 'Открыт список заявок',
    'application_approved': 'Заявка одобрена',
    'application_rejected': 'Заявка отклонена',
    'application_reverted': 'Решение по заявке отменено',
    'password_reset': 'Пароль восстановлен',
    'password_changed': 'Пароль изменён',
    'first_login_completed': 'Завершён первый вход',
    'recover_code_sent': 'Отправлен код восстановления',
    'recover_code_failed': 'Неверный код восстановления',
    'recover_code_ok': 'Код восстановления подтверждён',
    'recover_unknown': 'Запрос восстановления для неизвестной записи',
    'record_viewed': 'Открыта медкарта',
    'alerts_viewed': 'Открыт список алертов',
    'messages_viewed': 'Открыта переписка',
    'chat_viewed': 'Открыт чат',
    'relative_viewed': 'Открыт экран родственника',
    'thresholds_saved': 'Изменены пороги',
    'alert_accepted': 'Алерт принят',
    'alert_accept_undone': 'Принятие алерта отменено',
    'message_sent': 'Отправлено сообщение',
    'measurement_added': 'Добавлено измерение',
    'medication_intake': 'Отметка о приёме лекарства',
    'reminder_changed': 'Изменено напоминание',
    'reminder_added': 'Добавлено напоминание',
    'profile_updated': 'Изменён профиль',
    'device_connected': 'Устройство подключено',
    'device_disconnected': 'Устройство отключено',
    'device_synced': 'Устройство синхронизировано',
    'report_created': 'Сформирован отчёт',
    'report_viewed': 'Открыт отчёт',
    'relative_notifications': 'Изменены уведомления родственника',
}

# Группы событий для фильтра журнала аудита
ACTION_GROUPS = {
    'data': ['record_viewed', 'alerts_viewed', 'messages_viewed', 'chat_viewed', 'relative_viewed',
             'report_viewed', 'report_created', 'alert_accepted', 'alert_accept_undone'],
    'account': ['login', 'logout', 'user_created', 'user_blocked', 'user_unblocked', 'application_submitted',
                'application_approved', 'application_rejected', 'application_reverted', 'first_login_completed',
                'thresholds_saved', 'applications_viewed', 'user_deleted'],
    'security': ['login_failed', 'login_blocked', 'password_reset', 'password_changed', 'recover_code_sent',
                 'recover_code_failed', 'recover_code_ok', 'recover_unknown', 'password_reset_by_admin'],
    'notifications': ['message_sent', 'relative_notifications'],
}
SECURITY_ACTIONS = set(ACTION_GROUPS['security'])


def temp_password():
    """Временный пароль: буква, цифра и случайные символы — подходит под правила."""
    alphabet = string.ascii_letters + string.digits
    tail = ''.join(secrets.choice(alphabet) for _ in range(8))
    return f"{secrets.choice(string.ascii_uppercase)}{secrets.choice(string.digits)}{tail}"


def application_json(row):
    return {
        'id': row['id'],
        'role': row['role'],
        'roleLabel': ROLE_LABELS[row['role']],
        'name': row['name'],
        'phoneMasked': mask_phone(row['phone']),
        'email': row['email'],
        'extra': row['extra'],
        'createdAt': row['created_at'].isoformat(),
        'decidedAt': row['decided_at'].isoformat() if row['decided_at'] else None,
        'status': row['status'],
        'consentGiven': bool(row['consent_personal_data'] and row['consent_no_diagnosis']),
    }


@bp.get('/applications')
@login_required('admin')
def applications():
    with db_cursor() as cur:
        cur.execute(
            """SELECT * FROM applications
               WHERE status = 'pending' OR decided_at > now() - interval '30 days'
               ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 100"""
        )
        rows = cur.fetchall()
        cur.execute(
            """SELECT d.user_id, u.name FROM doctors d JOIN users u ON u.id = d.user_id
               WHERE NOT u.is_blocked ORDER BY u.name"""
        )
        doctors = cur.fetchall()
        cur.execute(
            """SELECT p.user_id, u.name FROM patients p JOIN users u ON u.id = p.user_id
               WHERE NOT u.is_blocked ORDER BY u.name"""
        )
        patients = cur.fetchall()
        audit(cur, 'applications_viewed', current_user()['id'], None, request.remote_addr)

    return jsonify({
        'applications': [application_json(row) for row in rows],
        'doctors': [{'id': row['user_id'], 'label': short_name(row['name'])} for row in doctors],
        'patients': [{'id': row['user_id'], 'label': short_name(row['name'])} for row in patients],
        'roles': [{'id': code, 'label': label} for code, label in ROLE_LABELS.items() if code != 'admin'],
        'nosologies': [{'id': code, 'label': label} for code, label in NOSOLOGIES.items()],
        'sexes': [{'id': code, 'label': label} for code, label in SEXES.items()],
    })


def parse_date(text):
    try:
        return date.fromisoformat(str(text))
    except (TypeError, ValueError):
        return None


def approve_patient(cur, application, data):
    try:
        doctor_id = int(data.get('doctorId'))
    except (TypeError, ValueError):
        return error('Выберите лечащего врача.')
    cur.execute("SELECT 1 FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = %s AND NOT u.is_blocked",
                (doctor_id,))
    if not cur.fetchone():
        return error('Врач не найден.')
    birth = parse_date(data.get('birthDate'))
    if not birth or birth >= date.today():
        return error('Укажите дату рождения.')
    if data.get('sex') not in SEXES:
        return error('Укажите пол.')
    if data.get('nosology') not in NOSOLOGIES:
        return error('Выберите нозологию.')
    diagnosis = str(data.get('diagnosis', '')).strip()
    icd = str(data.get('icdCode', '')).strip()
    if len(diagnosis) < 3 or len(icd) < 2:
        return error('Укажите диагноз и код МКБ.')

    password = temp_password()
    try:
        cur.execute(
            """INSERT INTO users (role, name, phone, email, password_hash, must_change_password)
               VALUES ('patient', %s, %s, %s, %s, TRUE) RETURNING id""",
            (application['name'], application['phone'], application['email'], generate_password_hash(password)),
        )
    except Exception:
        return error('С этим телефоном или e-mail уже есть учётная запись.', 409)
    user_id = cur.fetchone()['id']
    cur.execute(
        """INSERT INTO patients (user_id, doctor_id, birth_date, sex, nosology, diagnosis, icd_code)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (user_id, doctor_id, birth, data.get('sex'), data.get('nosology'), diagnosis, icd),
    )
    return user_id, password


def approve_relative(cur, application, data):
    try:
        patient_id = int(data.get('patientId'))
    except (TypeError, ValueError):
        return error('Выберите пациента, к которому открывается доступ.')
    cur.execute('SELECT 1 FROM patients WHERE user_id = %s', (patient_id,))
    if not cur.fetchone():
        return error('Пациент не найден.')

    password = temp_password()
    try:
        cur.execute(
            """INSERT INTO users (role, name, phone, email, password_hash, must_change_password)
               VALUES ('relative', %s, %s, %s, %s, TRUE) RETURNING id""",
            (application['name'], application['phone'], application['email'], generate_password_hash(password)),
        )
    except Exception:
        return error('С этим телефоном или e-mail уже есть учётная запись.', 409)
    user_id = cur.fetchone()['id']
    cur.execute(
        'INSERT INTO relative_links (relative_id, patient_id) VALUES (%s, %s) ON CONFLICT (relative_id) DO NOTHING',
        (user_id, patient_id),
    )
    return user_id, password


def approve_doctor(cur, application, data):
    specialty = str(data.get('specialty', '')).strip()
    clinic = str(data.get('clinic', '')).strip()
    if len(specialty) < 3 or len(clinic) < 3:
        return error('Укажите специальность и клинику.')

    password = temp_password()
    try:
        cur.execute(
            """INSERT INTO users (role, name, phone, email, password_hash, must_change_password)
               VALUES ('doctor', %s, %s, %s, %s, TRUE) RETURNING id""",
            (application['name'], application['phone'], application['email'], generate_password_hash(password)),
        )
    except Exception:
        return error('С этим телефоном или e-mail уже есть учётная запись.', 409)
    user_id = cur.fetchone()['id']
    cur.execute('INSERT INTO doctors (user_id, specialty, clinic) VALUES (%s, %s, %s)', (user_id, specialty, clinic))
    return user_id, password


APPROVERS = {'patient': approve_patient, 'relative': approve_relative, 'doctor': approve_doctor}


@bp.post('/applications/<int:application_id>/approve')
@login_required('admin')
def approve(application_id):
    admin = current_user()
    data = request.get_json(silent=True) or {}
    with db_cursor() as cur:
        cur.execute('SELECT * FROM applications WHERE id = %s FOR UPDATE', (application_id,))
        application = cur.fetchone()
        if not application:
            return error('Заявка не найдена.', 404)
        if application['status'] == 'approved':
            return error('Заявка уже одобрена.', 409)

        # Повторное одобрение после отмены решения: возвращаем доступ, новую учётку не создаём
        if application['approved_user_id']:
            cur.execute('SELECT deleted_at FROM users WHERE id = %s', (application['approved_user_id'],))
            approved_user = cur.fetchone()
            if not approved_user:
                return error('Учётная запись заявки не найдена.', 404)
            if approved_user['deleted_at']:
                return error('Учётная запись по этой заявке удалена. Заявку нужно подать заново.', 409)
            cur.execute('UPDATE users SET is_blocked = FALSE WHERE id = %s RETURNING id',
                        (application['approved_user_id'],))
            user_id = application['approved_user_id']
            password = None
        else:
            approver = APPROVERS.get(application['role'])
            if not approver:
                return error('Неизвестная роль заявки.')
            result = approver(cur, application, data)
            if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], int):
                return result  # error(...)
            user_id, password = result

        cur.execute("UPDATE applications SET status = 'approved', approved_user_id = %s, decided_at = now() "
                    "WHERE id = %s", (user_id, application_id))
        if password:
            notify(cur, f'HealthMonitor: доступ открыт. Временный пароль: {password}. '
                         'Войдите и привяжите Telegram, чтобы получать уведомления.', user_id=user_id)
        audit(cur, 'application_approved', admin['id'], f'application:{application_id}', request.remote_addr)
    return jsonify({'ok': True, 'userId': user_id, 'tempPassword': password})


@bp.post('/applications/<int:application_id>/reject')
@login_required('admin')
def reject(application_id):
    admin = current_user()
    with db_cursor() as cur:
        cur.execute("UPDATE applications SET status = 'rejected', decided_at = now() "
                    "WHERE id = %s AND status <> 'approved' RETURNING id", (application_id,))
        if not cur.fetchone():
            return error('Заявку нельзя отклонить: она одобрена или не найдена.', 409)
        audit(cur, 'application_rejected', admin['id'], f'application:{application_id}', request.remote_addr)
    return jsonify({'ok': True})


@bp.post('/applications/<int:application_id>/revert')
@login_required('admin')
def revert(application_id):
    admin = current_user()
    with db_cursor() as cur:
        cur.execute('SELECT * FROM applications WHERE id = %s FOR UPDATE', (application_id,))
        application = cur.fetchone()
        if not application or application['status'] == 'pending':
            return error('Решение по заявке не найдено.', 404)
        if application['approved_user_id']:
            cur.execute('UPDATE users SET is_blocked = TRUE WHERE id = %s', (application['approved_user_id'],))
        cur.execute("UPDATE applications SET status = 'pending', decided_at = NULL WHERE id = %s", (application_id,))
        audit(cur, 'application_reverted', admin['id'], f'application:{application_id}', request.remote_addr)
    return jsonify({'ok': True})


@bp.get('/users')
@login_required('admin')
def users():
    search = request.args.get('search', '').strip()
    role = request.args.get('role', 'all')
    if role not in ROLE_LABELS:
        role = 'all'
    me = current_user()
    with db_cursor() as cur:
        cur.execute(
            """SELECT u.*,
                      (SELECT max(a.created_at) FROM audit_log a
                        WHERE a.user_id = u.id AND a.action = 'login') AS last_login
               FROM users u
               WHERE (%s = 'all' OR u.role = %s)
                 AND u.deleted_at IS NULL
                 AND (%s = '' OR u.name ILIKE %s OR coalesce(u.email, '') ILIKE %s OR coalesce(u.phone, '') LIKE %s)
               ORDER BY u.name LIMIT 300""",
            (role, role, search, f'%{search}%', f'%{search}%', f'%{search}%'),
        )
        rows = cur.fetchall()
    return jsonify({'users': [{
        'id': row['id'],
        'name': row['name'],
        'role': row['role'],
        'roleLabel': ROLE_LABELS[row['role']],
        'contact': mask_phone(row['phone']) if row['phone'] else row['email'],
        'blocked': row['is_blocked'],
        'isSelf': row['id'] == me['id'],
        'lastLogin': row['last_login'].isoformat() if row['last_login'] else None,
    } for row in rows]})


@bp.post('/users/<int:user_id>/block')
@login_required('admin')
def block_user(user_id):
    admin = current_user()
    blocked = bool((request.get_json(silent=True) or {}).get('blocked'))
    if user_id == admin['id']:
        return error('Нельзя заблокировать самого себя.')
    with db_cursor() as cur:
        cur.execute('SELECT role, is_blocked FROM users WHERE id = %s FOR UPDATE', (user_id,))
        row = cur.fetchone()
        if not row:
            return error('Пользователь не найден.', 404)
        if blocked and row['role'] == 'admin':
            cur.execute("SELECT count(*) AS n FROM users WHERE role = 'admin' AND NOT is_blocked")
            if cur.fetchone()['n'] <= 1:
                return error('Нельзя заблокировать последнего администратора.')
        cur.execute('UPDATE users SET is_blocked = %s WHERE id = %s', (blocked, user_id))
        audit(cur, 'user_blocked' if blocked else 'user_unblocked', admin['id'], f'user:{user_id}',
              request.remote_addr, is_security=True)
    return jsonify({'blocked': blocked})


@bp.post('/users/<int:user_id>/reset-password')
@login_required('admin')
def reset_user_password(user_id):
    """Выдаёт новый временный пароль: показывается администратору один раз и уходит SMS."""
    admin = current_user()
    if user_id == admin['id']:
        return error('Свой пароль меняйте через восстановление доступа.')
    with db_cursor() as cur:
        cur.execute('SELECT * FROM users WHERE id = %s AND deleted_at IS NULL FOR UPDATE', (user_id,))
        user = cur.fetchone()
        if not user:
            return error('Пользователь не найден.', 404)
        password = temp_password()
        cur.execute(
            """UPDATE users SET password_hash = %s, must_change_password = FALSE,
                      password_changed_at = now(), session_version = session_version + 1
               WHERE id = %s""",
            (generate_password_hash(password), user_id),
        )
        if user['phone']:
            notify(cur, f'HealthMonitor: новый временный пароль: {password}. '
                        'Войдите и смените его в профиле.', user_id=user_id)
        audit(cur, 'password_reset_by_admin', admin['id'], f'user:{user_id}', request.remote_addr,
              is_security=True)
    return jsonify({
        'password': password,
        'login': mask_phone(user['phone']) if user['phone'] else user['email'],
    })


@bp.post('/users/<int:user_id>/delete')
@login_required('admin')
def delete_user(user_id):
    """Удаление аккаунта: вход запрещён, контакты и имя очищаются, медданные и аудит остаются."""
    admin = current_user()
    if user_id == admin['id']:
        return error('Нельзя удалить самого себя.')
    with db_cursor() as cur:
        cur.execute('SELECT role, deleted_at FROM users WHERE id = %s FOR UPDATE', (user_id,))
        row = cur.fetchone()
        if not row or row['deleted_at']:
            return error('Пользователь не найден.', 404)
        if row['role'] == 'admin':
            cur.execute("SELECT count(*) AS n FROM users WHERE role = 'admin' AND NOT is_blocked AND deleted_at IS NULL")
            if cur.fetchone()['n'] <= 1:
                return error('Нельзя удалить последнего администратора.')
        cur.execute(
            """UPDATE users SET deleted_at = now(), is_blocked = TRUE, phone = NULL, email = NULL,
                      name = 'Удалённая учётная запись', session_version = session_version + 1
               WHERE id = %s""",
            (user_id,),
        )
        audit(cur, 'user_deleted', admin['id'], f'user:{user_id}', request.remote_addr, is_security=True)
    return jsonify({'ok': True})


ANALYTICS_PERIODS = (7, 14, 30, 90)


def _rate(part, whole):
    return round(part / whole, 4) if whole else None


def _minutes(value):
    return round(float(value), 1) if value is not None else None


@bp.get('/analytics')
@login_required('admin')
def analytics():
    """Дашборд метрик: вовлечённость, воронка, алерты, приверженность."""
    try:
        days = int(request.args.get('days', 30))
    except ValueError:
        days = 0
    if days not in ANALYTICS_PERIODS:
        return error('Период должен быть 7, 14, 30 или 90 дней.')

    with db_cursor() as cur:
        cur.execute('SELECT role, count(*) AS total FROM users WHERE deleted_at IS NULL GROUP BY role')
        roles = {row['role']: row['total'] for row in cur.fetchall()}

        cur.execute(
            """SELECT
                 count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '1 day') AS dau,
                 count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '7 days') AS wau,
                 count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '30 days') AS mau
               FROM audit_log WHERE user_id IS NOT NULL"""
        )
        active = cur.fetchone()

        cur.execute(
            """WITH days AS (
                 SELECT generate_series(
                   date_trunc('day', now() - make_interval(days => %s)),
                   date_trunc('day', now()),
                   interval '1 day'
                 ) AS day
               )
               SELECT day::date AS date,
                 (SELECT count(DISTINCT a.user_id) FROM audit_log a
                   WHERE a.user_id IS NOT NULL AND a.created_at >= day AND a.created_at < day + interval '1 day') AS active,
                 (SELECT count(*) FROM users u
                   WHERE u.deleted_at IS NULL AND u.created_at >= day AND u.created_at < day + interval '1 day') AS "newUsers",
                 (SELECT count(*) FROM measurements m
                   WHERE m.measured_at >= day AND m.measured_at < day + interval '1 day') AS measurements
               FROM days ORDER BY day""",
            (days,),
        )
        daily = [{
            'date': row['date'].isoformat(),
            'active': row['active'],
            'newUsers': row['newUsers'],
            'measurements': row['measurements'],
        } for row in cur.fetchall()]

        cur.execute(
            """WITH cohort AS (
                 SELECT id, created_at FROM users
                 WHERE deleted_at IS NULL AND created_at >= now() - make_interval(days => %s)
               )
               SELECT
                 count(*) AS total,
                 count(*) FILTER (WHERE created_at <= now() - interval '1 day') AS d1_base,
                 count(*) FILTER (WHERE created_at <= now() - interval '1 day' AND EXISTS (
                     SELECT 1 FROM audit_log a WHERE a.user_id = cohort.id
                       AND a.created_at >= cohort.created_at + interval '1 day'
                       AND a.created_at < cohort.created_at + interval '2 days')) AS d1,
                 count(*) FILTER (WHERE created_at <= now() - interval '7 days') AS d7_base,
                 count(*) FILTER (WHERE created_at <= now() - interval '7 days' AND EXISTS (
                     SELECT 1 FROM audit_log a WHERE a.user_id = cohort.id
                       AND a.created_at >= cohort.created_at + interval '7 days'
                       AND a.created_at < cohort.created_at + interval '8 days')) AS d7,
                 count(*) FILTER (WHERE created_at <= now() - interval '30 days') AS d30_base,
                 count(*) FILTER (WHERE created_at <= now() - interval '30 days' AND EXISTS (
                     SELECT 1 FROM audit_log a WHERE a.user_id = cohort.id
                       AND a.created_at >= cohort.created_at + interval '30 days'
                       AND a.created_at < cohort.created_at + interval '31 days')) AS d30
               FROM cohort""",
            (days,),
        )
        retention = cur.fetchone()

        cur.execute(
            """SELECT count(*) AS active, count(*) FILTER (WHERE days >= 2) AS returning
               FROM (
                 SELECT user_id, count(DISTINCT created_at::date) AS days
                 FROM audit_log WHERE user_id IS NOT NULL AND created_at >= now() - make_interval(days => %s)
                 GROUP BY user_id
               ) t""",
            (days,),
        )
        returning = cur.fetchone()

        cur.execute(
            """WITH apps AS (
                 SELECT a.id, a.approved_user_id FROM applications a
                 WHERE a.role = 'patient' AND a.created_at >= now() - make_interval(days => %s)
               )
               SELECT count(*) AS submitted,
                 count(*) FILTER (WHERE approved_user_id IS NOT NULL) AS approved,
                 count(*) FILTER (WHERE approved_user_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM audit_log a WHERE a.user_id = apps.approved_user_id AND a.action = 'login')) AS logged_in,
                 count(*) FILTER (WHERE approved_user_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM measurements m WHERE m.patient_id = apps.approved_user_id)) AS measured
               FROM apps""",
            (days,),
        )
        funnel = cur.fetchone()

        cur.execute(
            """SELECT count(*) AS total,
                 count(*) FILTER (WHERE level = 'crit') AS crit,
                 count(*) FILTER (WHERE level = 'warn') AS warn,
                 count(*) FILTER (WHERE level = 'nodata') AS nodata,
                 count(*) FILTER (WHERE accepted_at IS NOT NULL) AS accepted,
                 count(*) FILTER (WHERE accepted_at IS NOT NULL AND accepted_at <= created_at + interval '15 minutes') AS within15,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at)) / 60.0)
                   FILTER (WHERE accepted_at IS NOT NULL) AS median_minutes
               FROM alerts WHERE created_at >= now() - make_interval(days => %s)""",
            (days,),
        )
        alerts = cur.fetchone()

        cur.execute(
            """WITH days AS (
                 SELECT generate_series(
                   date_trunc('day', now() - make_interval(days => %s)),
                   date_trunc('day', now()),
                   interval '1 day'
                 ) AS day
               )
               SELECT day::date AS date,
                 (SELECT count(*) FROM alerts a WHERE a.created_at >= day AND a.created_at < day + interval '1 day') AS created,
                 (SELECT count(*) FROM alerts a WHERE a.accepted_at >= day AND a.accepted_at < day + interval '1 day') AS accepted
               FROM days ORDER BY day""",
            (days,),
        )
        alerts_daily = [{
            'date': row['date'].isoformat(),
            'created': row['created'],
            'accepted': row['accepted'],
        } for row in cur.fetchall()]

        cur.execute(
            """SELECT count(*) AS total,
                 count(*) FILTER (WHERE kind = 'glucose') AS glucose,
                 count(*) FILTER (WHERE kind = 'bp') AS bp,
                 count(*) FILTER (WHERE kind = 'pef') AS pef,
                 count(DISTINCT patient_id) AS patients
               FROM measurements WHERE measured_at >= now() - make_interval(days => %s)""",
            (days,),
        )
        clinical = cur.fetchone()

        cur.execute(
            """SELECT count(*) AS count FROM users u
               WHERE u.role = 'patient' AND u.deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM measurements m
                   WHERE m.patient_id = u.id AND m.measured_at >= now() - interval '2 days')"""
        )
        without_data = cur.fetchone()['count']

        cur.execute(
            """SELECT
                 (SELECT count(*) FROM medication_intakes i
                    JOIN medication_slots s ON s.id = i.slot_id
                    WHERE i.taken_on >= current_date - %s AND s.enabled) AS taken,
                 (SELECT count(*) FROM medication_slots s
                    JOIN medications m ON m.id = s.medication_id
                    JOIN users u ON u.id = m.patient_id
                    WHERE s.enabled AND u.deleted_at IS NULL) * %s AS expected""",
            (days, days),
        )
        adherence = cur.fetchone()

        cur.execute(
            """WITH latest AS (
                 SELECT DISTINCT ON (user_id, kind) user_id, kind, score
                 FROM survey_responses
                 WHERE created_at >= now() - make_interval(days => %s)
                 ORDER BY user_id, kind, created_at DESC
               )
               SELECT kind, count(*) AS responses,
                      avg(score) AS avg_score,
                      count(*) FILTER (WHERE kind = 'nps' AND score >= 9) AS promoters,
                      count(*) FILTER (WHERE kind = 'nps' AND score <= 6) AS detractors,
                      count(*) FILTER (WHERE kind = 'csat' AND score >= 4) AS satisfied
               FROM latest GROUP BY kind""",
            (days,),
        )
        surveys = {row['kind']: row for row in cur.fetchall()}

    nps = surveys.get('nps')
    csat = surveys.get('csat')
    ces = surveys.get('ces')
    nps_score = None
    if nps and nps['responses']:
        nps_score = round((nps['promoters'] - nps['detractors']) / nps['responses'] * 100, 1)

    return jsonify({
        'period': {'days': days},
        'users': {
            'total': sum(roles.values()),
            'byRole': roles,
        },
        'engagement': {
            'dau': active['dau'],
            'wau': active['wau'],
            'mau': active['mau'],
            'stickiness': _rate(active['dau'], active['mau']),
            'returning': _rate(returning['returning'], returning['active']),
            'newUsers': retention['total'],
            'retention': {
                'd1': _rate(retention['d1'], retention['d1_base']),
                'd7': _rate(retention['d7'], retention['d7_base']),
                'd30': _rate(retention['d30'], retention['d30_base']),
            },
            'daily': daily,
        },
        'funnel': {
            'submitted': funnel['submitted'],
            'approved': funnel['approved'],
            'loggedIn': funnel['logged_in'],
            'measured': funnel['measured'],
            'rates': {
                'approved': _rate(funnel['approved'], funnel['submitted']),
                'loggedIn': _rate(funnel['logged_in'], funnel['approved']),
                'measured': _rate(funnel['measured'], funnel['logged_in']),
            },
        },
        'alerts': {
            'total': alerts['total'],
            'crit': alerts['crit'],
            'warn': alerts['warn'],
            'nodata': alerts['nodata'],
            'accepted': alerts['accepted'],
            'acceptanceRate': _rate(alerts['accepted'], alerts['total']),
            'within15Rate': _rate(alerts['within15'], alerts['total']),
            'medianMinutes': _minutes(alerts['median_minutes']),
            'daily': alerts_daily,
        },
        'clinical': {
            'measurements': clinical['total'],
            'byKind': {'glucose': clinical['glucose'], 'bp': clinical['bp'], 'pef': clinical['pef']},
            'activePatients': clinical['patients'],
            'withoutData': without_data,
            'adherence': _rate(adherence['taken'], adherence['expected']),
        },
        'quality': {
            'nps': nps_score,
            'npsResponses': nps['responses'] if nps else 0,
            'promoters': nps['promoters'] if nps else 0,
            'detractors': nps['detractors'] if nps else 0,
            'csat': round(float(csat['avg_score']), 2) if csat and csat['avg_score'] is not None else None,
            'csatResponses': csat['responses'] if csat else 0,
            'csatSatisfied': _rate(csat['satisfied'], csat['responses']) if csat else None,
            'ces': round(float(ces['avg_score']), 2) if ces and ces['avg_score'] is not None else None,
            'cesResponses': ces['responses'] if ces else 0,
            'responses': sum(row['responses'] for row in surveys.values()),
        },
        'monetization': None,
    })


@bp.get('/audit')
@login_required('admin')
def audit_log():
    group = request.args.get('type', 'all')
    with db_cursor() as cur:
        if group in ACTION_GROUPS:
            cur.execute(
                """SELECT a.*, u.name AS user_name FROM audit_log a
                   LEFT JOIN users u ON u.id = a.user_id
                   WHERE a.action = ANY(%s) ORDER BY a.created_at DESC LIMIT 200""",
                (ACTION_GROUPS[group],),
            )
        else:
            cur.execute(
                """SELECT a.*, u.name AS user_name FROM audit_log a
                   LEFT JOIN users u ON u.id = a.user_id
                   ORDER BY a.created_at DESC LIMIT 200"""
            )
        rows = cur.fetchall()
    return jsonify({
        'groups': [{'id': 'all', 'label': 'Все события'}, {'id': 'data', 'label': 'Доступ к медданным'},
                   {'id': 'account', 'label': 'Учётные записи и роли'}, {'id': 'security', 'label': 'Безопасность'},
                   {'id': 'notifications', 'label': 'Уведомления'}],
        'events': [{
            'id': row['id'],
            'createdAt': row['created_at'].isoformat(),
            'who': short_name(row['user_name']) if row['user_name'] else 'Система',
            'action': ACTION_LABELS.get(row['action'], row['action']),
            'object': row['object'],
            'ip': row['ip'],
            'security': row['is_security'] or row['action'] in SECURITY_ACTIONS,
        } for row in rows],
    })
