"""Пороги алертов и правила эскалации: на пациента или шаблоном на нозологию."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request

from db import audit, db_cursor
from monitoring import THRESHOLD_FIELDS, fmt_number, load_settings, load_thresholds
from security import current_user, error, login_required, short_name

bp = Blueprint('thresholds', __name__, url_prefix='/api/doctor/thresholds')

# metric, подпись, единицы, максимальное допустимое значение
METRICS = [
    ('glucose', 'Глюкоза крови', 'ммоль/л', Decimal(50)),
    ('bp_sys', 'Давление, верхнее', 'мм рт. ст.', Decimal(300)),
    ('bp_dia', 'Давление, нижнее', 'мм рт. ст.', Decimal(300)),
    ('pef', 'Пиковая скорость выдоха', '% от лучшего', Decimal(100)),
]
METRIC_INFO = {metric: (label, unit, limit) for metric, label, unit, limit in METRICS}

NOSOLOGIES = [
    ('diabetes', 'сахарный диабет'),
    ('hypertension', 'гипертония'),
    ('asthma', 'астма'),
]
NOSOLOGY_LABELS = dict(NOSOLOGIES)
DEFAULT_NOSOLOGY = 'diabetes'
ESCALATION_MINUTES = (10, 15, 20)

# Поля формы для четырёх порогов
FORM_FIELDS = {'critLow': 'crit_low', 'warnLow': 'warn_low', 'warnHigh': 'warn_high', 'critHigh': 'crit_high'}


def own_patients(cur, doctor_id):
    cur.execute(
        """SELECT p.*, u.name FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.doctor_id = %s ORDER BY u.name""",
        (doctor_id,),
    )
    return cur.fetchall()


def scopes_json(patients):
    return {
        'patients': [{'type': 'patient', 'id': row['user_id'], 'label': f"Пациент: {short_name(row['name'])}"}
                     for row in patients],
        'nosologies': [{'type': 'nosology', 'id': code, 'label': f'Шаблон: {label}'}
                       for code, label in NOSOLOGIES],
    }


def patient_scope(row):
    return {
        'type': 'patient',
        'id': row['user_id'],
        'label': f"Пациент: {short_name(row['name'])}",
        'patient': {'user_id': row['user_id'], 'nosology': row['nosology'], 'pef_best': row['pef_best']},
    }


def nosology_scope(code):
    return {
        'type': 'nosology',
        'id': code,
        'label': f'Шаблон: {NOSOLOGY_LABELS[code]}',
        'patient': {'user_id': None, 'nosology': code, 'pef_best': None},
    }


def default_scope(patients):
    return patient_scope(patients[0]) if patients else nosology_scope(DEFAULT_NOSOLOGY)


def find_scope(patients, scope_type, scope_id):
    if scope_type == 'patient':
        row = next((item for item in patients if str(item['user_id']) == str(scope_id)), None)
        return patient_scope(row) if row else None
    if scope_type == 'nosology' and scope_id in NOSOLOGY_LABELS:
        return nosology_scope(scope_id)
    return None


def values_of(limits, metric):
    return {field: fmt_number(limits[field], metric) if limits[field] is not None else None
            for field in THRESHOLD_FIELDS}


def form_payload(scope, thresholds, settings):
    return {
        'scope': {'type': scope['type'], 'id': scope['id'], 'label': scope['label']},
        'rows': [{'metric': metric, 'label': label, 'unit': unit, 'values': values_of(thresholds[metric], metric)}
                 for metric, label, unit, _ in METRICS],
        'settings': {
            'escalationMinutes': settings['escalation_minutes'],
            'smsRelative': settings['sms_relative'],
            'noDataAlert': settings['no_data_alert'],
        },
    }


def load(cur, scope):
    return load_thresholds(cur, scope['patient']), load_settings(cur, scope['patient'])


def parse_value(raw, metric):
    if raw is None:
        return None
    text = str(raw).strip().replace(',', '.').replace(' ', '')
    if not text:
        return None
    try:
        value = Decimal(text)
    except InvalidOperation:
        raise ValueError('Пороги должны быть числами.')
    limit = METRIC_INFO[metric][2]
    if value <= 0 or value > limit:
        raise ValueError(f'{METRIC_INFO[metric][0]}: значение вне допустимого диапазона.')
    return value


def parse_rows(raw_rows):
    if not isinstance(raw_rows, list) or not raw_rows:
        raise ValueError('Нет порогов для сохранения.')
    rows = {}
    for item in raw_rows:
        metric = item.get('metric')
        if metric not in METRIC_INFO:
            raise ValueError('Неизвестный показатель.')
        values = {field: parse_value(item.get(key), metric) for key, field in FORM_FIELDS.items()}
        filled = [value for value in values.values() if value is not None]
        if any(later <= earlier for earlier, later in zip(filled, filled[1:])):
            raise ValueError(f"{METRIC_INFO[metric][0]}: пороги должны возрастать слева направо.")
        rows[metric] = values
    if set(rows) != set(METRIC_INFO):
        raise ValueError('Нужны пороги всех четырёх показателей.')
    return rows


def parse_settings(raw_settings):
    raw_settings = raw_settings if isinstance(raw_settings, dict) else {}
    try:
        escalation = int(raw_settings.get('escalationMinutes', 15))
    except (TypeError, ValueError):
        raise ValueError('Время эскалации должно быть числом.')
    if escalation not in ESCALATION_MINUTES:
        raise ValueError('Время эскалации: 10, 15 или 20 минут.')
    return {
        'escalation_minutes': escalation,
        'sms_relative': raw_settings.get('smsRelative') is True,
        'no_data_alert': raw_settings.get('noDataAlert') is True,
    }


def save_thresholds(cur, scope, rows):
    for metric, values in rows.items():
        if scope['type'] == 'patient':
            cur.execute('DELETE FROM thresholds WHERE patient_id = %s AND metric = %s', (scope['id'], metric))
        else:
            cur.execute('DELETE FROM thresholds WHERE nosology = %s AND metric = %s', (scope['id'], metric))
        if all(value is None for value in values.values()):
            continue
        cur.execute(
            """INSERT INTO thresholds (patient_id, nosology, metric, crit_low, warn_low, warn_high, crit_high)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (scope['id'] if scope['type'] == 'patient' else None,
             scope['id'] if scope['type'] == 'nosology' else None,
             metric, values['crit_low'], values['warn_low'], values['warn_high'], values['crit_high']),
        )


def save_settings(cur, scope, settings):
    column = 'patient_id' if scope['type'] == 'patient' else 'nosology'
    cur.execute(
        f"""INSERT INTO alert_settings ({column}, escalation_minutes, sms_relative, no_data_alert)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT ({column}) DO UPDATE SET escalation_minutes = EXCLUDED.escalation_minutes,
                                                 sms_relative = EXCLUDED.sms_relative,
                                                 no_data_alert = EXCLUDED.no_data_alert""",
        (scope['id'], settings['escalation_minutes'], settings['sms_relative'], settings['no_data_alert']),
    )


@bp.get('')
@login_required('doctor')
def view():
    user = current_user()
    scope_type = request.args.get('scope')
    scope_id = request.args.get('id')
    with db_cursor() as cur:
        patients = own_patients(cur, user['id'])
        scope = find_scope(patients, scope_type, scope_id) if scope_type else default_scope(patients)
        if not scope:
            return error('Пациент не найден.', 404)
        thresholds, settings = load(cur, scope)
    return jsonify({'scopes': scopes_json(patients), **form_payload(scope, thresholds, settings)})


@bp.post('')
@login_required('doctor')
def save():
    user = current_user()
    data = request.get_json(silent=True) or {}
    scope_in = data.get('scope') or {}
    with db_cursor() as cur:
        patients = own_patients(cur, user['id'])
        scope = find_scope(patients, scope_in.get('type'), scope_in.get('id'))
        if not scope:
            return error('Пациент не найден.', 404)
        try:
            rows = parse_rows(data.get('rows'))
            settings = parse_settings(data.get('settings'))
        except ValueError as e:
            return error(str(e))

        save_thresholds(cur, scope, rows)
        save_settings(cur, scope, settings)
        audit(cur, 'thresholds_saved', user['id'],
              f"{scope['type']}:{scope['id']}", request.remote_addr)
        thresholds, saved = load(cur, scope)
    return jsonify({
        'scopes': scopes_json(patients),
        **form_payload(scope, thresholds, saved),
        'savedAt': datetime.now(timezone.utc).isoformat(),
    })
