from functools import wraps

from flask import Blueprint, jsonify, request

from auth import set_password
from db import audit, db_cursor
from security import current_user, error, login_required, mask_phone, normalize_phone, password_problem, start_session
from sms import send_sms

bp = Blueprint('welcome', __name__, url_prefix='/api/welcome')


def short_name(full_name):
    """Иванова Мария Петровна → Иванова М. П."""
    surname, *rest = full_name.split()
    return ' '.join([surname, *(part[0] + '.' for part in rest)])


def load_profile(cur, user_id):
    cur.execute(
        """SELECT u.name, u.phone, p.birth_date, d.name AS doctor_name, doc.specialty, doc.clinic
           FROM patients p
           JOIN users u ON u.id = p.user_id
           JOIN doctors doc ON doc.user_id = p.doctor_id
           JOIN users d ON d.id = doc.user_id
           WHERE p.user_id = %s""",
        (user_id,),
    )
    return cur.fetchone()


def first_login_only(view):
    """Мастер первого входа доступен только пациенту с временным паролем."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user()['must_change_password']:
            return error('Первый вход уже выполнен.', 409)
        return view(*args, **kwargs)
    return wrapper


@bp.get('/profile')
@login_required('patient')
@first_login_only
def profile():
    with db_cursor() as cur:
        row = load_profile(cur, current_user()['id'])
    if not row:
        return error('Карта пациента ещё не заполнена. Позвоните в регистратуру.', 404)
    return jsonify({
        'name': row['name'],
        'birthDate': row['birth_date'].strftime('%d.%m.%Y'),
        'phoneMasked': mask_phone(row['phone']) if row['phone'] else '—',
        'doctor': {'name': row['doctor_name'], 'shortName': short_name(row['doctor_name']), 'specialty': row['specialty']},
        'clinic': row['clinic'],
    })


@bp.post('/complete')
@login_required('patient')
@first_login_only
def complete():
    data = request.get_json(silent=True) or {}
    password = str(data.get('password', ''))
    consents = data.get('consents') or {}
    relative = data.get('relative')
    user = current_user()

    with db_cursor() as cur:
        row = load_profile(cur, user['id'])
        if not row:
            return error('Карта пациента ещё не заполнена. Позвоните в регистратуру.', 404)

        phone = user['phone'] or ''
        problem = password_problem(password, (phone[-4:], str(row['birth_date'].year)))
        if problem:
            return error(problem)
        if consents.get('personalData') is not True or consents.get('noDiagnosis') is not True:
            return error('Без обоих согласий наблюдение начать нельзя.')

        relative_phone = None
        if relative:
            relative_name = str(relative.get('name', '')).strip()
            relative_phone = normalize_phone(str(relative.get('phone', '')))
            if len(relative_name) < 2 or not relative_phone:
                return error('Укажите имя близкого и его телефон.')

        updated = set_password(cur, user['id'], password)
        cur.executemany(
            'INSERT INTO consents (user_id, kind) VALUES (%s, %s)',
            [(user['id'], 'personal_data'), (user['id'], 'no_diagnosis')] + ([(user['id'], 'relative_sms')] if relative else []),
        )
        if relative:
            cur.execute(
                """INSERT INTO patient_contacts (patient_id, name, phone, sms_alerts) VALUES (%s, %s, %s, TRUE)
                   ON CONFLICT (patient_id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, sms_alerts = TRUE""",
                (user['id'], relative_name, relative_phone),
            )
            send_sms(cur, relative_phone,
                     f'HealthMonitor: {short_name(user["name"])} указал(а) вас близким. '
                     'Вы будете получать SMS, если показатель выйдет за критический порог.')
        audit(cur, 'first_login_completed', user['id'], f'patient:{user["id"]}', request.remote_addr)

    # Пароль сменён — текущий сеанс продолжаем с новой версией
    start_session(updated)
    return jsonify({'ok': True})
