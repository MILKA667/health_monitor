"""Экраны пациента: главная с планом на сегодня, ввод показателя и алерт."""
from datetime import date, datetime, timezone
import re

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

import chat
from db import audit, db_cursor, today as app_today
from doctor import chart_payload, stats_payload
from monitoring import (NOSOLOGY_KIND, UNITS, evaluate, fmt_number, fmt_value, load_thresholds, record_measurement,
                        target_text)
from security import current_user, error, login_required, mask_phone, password_problem, short_name, start_session
from sms import send_sms

bp = Blueprint('patient', __name__, url_prefix='/api/patient')

KIND_TITLES = {'glucose': 'Глюкоза крови', 'bp': 'Артериальное давление', 'pef': 'Пиковая скорость выдоха'}
CONTEXT_TITLES = {'fast': 'Натощак', 'after': 'Через 2 часа после еды', 'night': 'Перед сном'}
REMINDER_TITLES = {'glucose': 'Замер глюкозы натощак', 'bp': 'Измерение давления', 'pef': 'Пиковая скорость выдоха'}
WELLBEING = ('good', 'weak', 'dizzy', 'sweat')
RANGES = {'glucose': (1, 35), 'bp': ((60, 260), (30, 160)), 'pef': (50, 900)}


def iso(value):
    return value.isoformat() if value else None


def own_patient(cur):
    user = current_user()
    cur.execute(
        """SELECT p.*, u.name, u.phone, u.password_changed_at FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.user_id = %s""",
        (user['id'],),
    )
    return cur.fetchone()


def measurement_card(row, thresholds, patient):
    level, deviation, _ = evaluate(row, thresholds, patient['pef_best'])
    return {
        'id': row['id'],
        'value': fmt_value(row),
        'unit': UNITS[row['kind']],
        'level': level,
        'deviation': deviation,
        'context': CONTEXT_TITLES.get(row['context'], ''),
        'measuredAt': iso(row['measured_at']),
        'isToday': row['measured_at'].date() == app_today(),
    }


def plan_items(cur, patient):
    """План на сегодня: приёмы лекарств и замеры с отметками о выполнении."""
    today = app_today()
    items = []
    cur.execute(
        """SELECT s.id, s.time_of_day, s.dose, m.name FROM medication_slots s
           JOIN medications m ON m.id = s.medication_id
           WHERE m.patient_id = %s AND m.enabled AND s.enabled
           ORDER BY s.time_of_day""",
        (patient['user_id'],),
    )
    for row in cur.fetchall():
        cur.execute('SELECT 1 FROM medication_intakes WHERE slot_id = %s AND taken_on = %s', (row['id'], today))
        items.append({
            'id': f"slot:{row['id']}",
            'type': 'medication',
            'slotId': row['id'],
            'title': row['name'],
            'subtitle': row['dose'],
            'time': row['time_of_day'].strftime('%H:%M'),
            'done': bool(cur.fetchone()),
        })

    cur.execute(
        'SELECT id, kind, time_of_day FROM measurement_reminders WHERE patient_id = %s AND enabled ORDER BY time_of_day',
        (patient['user_id'],),
    )
    for row in cur.fetchall():
        cur.execute(
            """SELECT 1 FROM measurements WHERE patient_id = %s AND kind = %s
               AND measured_at::date = %s LIMIT 1""",
            (patient['user_id'], row['kind'], today),
        )
        done = bool(cur.fetchone())
        cur.execute('SELECT 1 FROM devices WHERE patient_id = %s AND kind = %s AND connected LIMIT 1',
                    (patient['user_id'], {'glucose': 'glucometer', 'bp': 'tonometer', 'pef': 'peakflow'}[row['kind']]))
        subtitle = 'Данные передаст устройство' if cur.fetchone() else 'Внесите показатель вручную'
        items.append({
            'id': f"reminder:{row['id']}",
            'type': 'measurement',
            'kind': row['kind'],
            'title': REMINDER_TITLES[row['kind']],
            'subtitle': subtitle,
            'time': row['time_of_day'].strftime('%H:%M'),
            'done': done,
        })

    items.sort(key=lambda item: item['time'])
    return {'done': sum(1 for item in items if item['done']), 'total': len(items), 'items': items}


def threshold_limits(limits):
    return {field: float(value) if value is not None else None for field, value in limits.items()}


@bp.get('/home')
@login_required('patient')
def home():
    user = current_user()
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        thresholds = load_thresholds(cur, patient)
        kind = NOSOLOGY_KIND[patient['nosology']]
        cur.execute(
            'SELECT * FROM measurements WHERE patient_id = %s ORDER BY measured_at DESC LIMIT 4',
            (patient['user_id'],),
        )
        rows = cur.fetchall()
        plan = plan_items(cur, patient)

    return jsonify({
        'name': short_name(user['name']),
        'kind': kind,
        'kindTitle': KIND_TITLES[kind],
        'target': target_text(patient, thresholds),
        'pefBest': patient['pef_best'],
        'limits': {'sys': threshold_limits(thresholds['bp_sys']), 'dia': threshold_limits(thresholds['bp_dia'])}
        if kind == 'bp' else threshold_limits(thresholds[kind]),
        'last': measurement_card(rows[0], thresholds, patient) if rows else None,
        'recent': [measurement_card(row, thresholds, patient) for row in rows[1:]],
        'plan': plan,
    })


@bp.post('/plan/medications/<int:slot_id>')
@login_required('patient')
def toggle_intake(slot_id):
    done = bool((request.get_json(silent=True) or {}).get('done'))
    with db_cursor() as cur:
        patient = own_patient(cur)
        cur.execute(
            """SELECT s.id FROM medication_slots s JOIN medications m ON m.id = s.medication_id
               WHERE s.id = %s AND m.patient_id = %s""",
            (slot_id, patient['user_id'] if patient else None),
        )
        if not cur.fetchone():
            return error('Приём не найден.', 404)
        if done:
            cur.execute(
                'INSERT INTO medication_intakes (slot_id, taken_on) VALUES (%s, %s) ON CONFLICT DO NOTHING',
                (slot_id, app_today()),
            )
        else:
            cur.execute('DELETE FROM medication_intakes WHERE slot_id = %s AND taken_on = %s',
                        (slot_id, app_today()))
        audit(cur, 'medication_intake', patient['user_id'], f'slot:{slot_id}', request.remote_addr)
    return jsonify({'done': done})


REMINDER_TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')

DEVICE_LABELS = {'glucometer': 'Глюкометр', 'tonometer': 'Тонометр', 'peakflow': 'Пикфлоуметр'}
DEVICE_MODELS = {'glucometer': '[модель глюкометра]', 'tonometer': '[модель тонометра]',
                 'peakflow': '[модель пикфлоуметра]'}
DEVICE_OF_KIND = {'glucose': 'glucometer', 'bp': 'tonometer', 'pef': 'peakflow'}


def device_json(row):
    return {
        'id': row['id'],
        'kind': row['kind'],
        'name': DEVICE_LABELS[row['kind']],
        'model': row['model'],
        'connected': row['connected'],
        'lastSync': iso(row['last_sync']),
    }


def profile_payload(cur, patient):
    cur.execute(
        'SELECT u.name, d.specialty FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = %s',
        (patient['doctor_id'],),
    )
    doctor = cur.fetchone()
    cur.execute('SELECT name, phone, sms_alerts FROM patient_contacts WHERE patient_id = %s', (patient['user_id'],))
    contact = cur.fetchone()
    cur.execute('SELECT * FROM devices WHERE patient_id = %s ORDER BY id', (patient['user_id'],))
    devices = cur.fetchall()
    cur.execute('SELECT * FROM patient_settings WHERE patient_id = %s', (patient['user_id'],))
    settings = cur.fetchone()
    cur.execute(
        """SELECT kind, max(given_at) AS given_at FROM consents
           WHERE user_id = %s AND revoked_at IS NULL GROUP BY kind""",
        (patient['user_id'],),
    )
    consents = {row['kind']: row['given_at'] for row in cur.fetchall()}

    return {
        'name': patient['name'],
        'phoneMasked': mask_phone(patient['phone']) if patient['phone'] else None,
        'doctor': {'name': short_name(doctor['name']) if doctor else None,
                   'specialty': doctor['specialty'] if doctor else None},
        'relative': contact and {
            'name': contact['name'],
            'phoneMasked': mask_phone(contact['phone']),
            'smsAlerts': contact['sms_alerts'],
        },
        'devices': [device_json(row) for row in devices],
        'channels': {
            'push': settings['push_enabled'] if settings else True,
            'sms': settings['sms_enabled'] if settings else True,
        },
        'consents': {
            'personalData': iso(consents.get('personal_data')),
            'relativeAccess': iso(consents.get('relative_sms')),
        },
        'passwordChangedAt': iso(patient['password_changed_at']),
    }


@bp.get('/profile')
@login_required('patient')
def profile():
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        payload = profile_payload(cur, patient)
    return jsonify(payload)


@bp.post('/profile')
@login_required('patient')
def update_profile():
    data = request.get_json(silent=True) or {}
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)

        if 'relativeSms' in data:
            cur.execute('SELECT 1 FROM patient_contacts WHERE patient_id = %s', (patient['user_id'],))
            if cur.fetchone():
                cur.execute('UPDATE patient_contacts SET sms_alerts = %s WHERE patient_id = %s',
                            (bool(data.get('relativeSms')), patient['user_id']))

        cur.execute('SELECT * FROM patient_settings WHERE patient_id = %s', (patient['user_id'],))
        settings = cur.fetchone() or {'push_enabled': True, 'sms_enabled': True}
        push = bool(data.get('push', settings['push_enabled']))
        sms = bool(data.get('sms', settings['sms_enabled']))
        if not push and not sms:
            return error('Выберите хотя бы один способ, иначе напоминания не придут.')
        cur.execute(
            """INSERT INTO patient_settings (patient_id, push_enabled, sms_enabled) VALUES (%s, %s, %s)
               ON CONFLICT (patient_id) DO UPDATE SET push_enabled = EXCLUDED.push_enabled,
                                                     sms_enabled = EXCLUDED.sms_enabled""",
            (patient['user_id'], push, sms),
        )
        audit(cur, 'profile_updated', patient['user_id'], None, request.remote_addr)
        payload = profile_payload(cur, patient)
    return jsonify(payload)


@bp.get('/devices')
@login_required('patient')
def devices():
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        cur.execute('SELECT * FROM devices WHERE patient_id = %s ORDER BY id', (patient['user_id'],))
        rows = cur.fetchall()
        device_kind = DEVICE_OF_KIND[NOSOLOGY_KIND[patient['nosology']]]
    return jsonify({
        'devices': [device_json(row) for row in rows],
        'options': [{'kind': device_kind, 'label': DEVICE_LABELS[device_kind]}],
    })


@bp.post('/devices/connect')
@login_required('patient')
def connect_device():
    data = request.get_json(silent=True) or {}
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        kind = DEVICE_OF_KIND[NOSOLOGY_KIND[patient['nosology']]]
        if data.get('kind') != kind:
            return error('Подключить можно устройство для вашего показателя.')
        cur.execute(
            """INSERT INTO devices (patient_id, kind, model, connected, last_sync)
               VALUES (%s, %s, %s, TRUE, NULL)
               ON CONFLICT DO NOTHING RETURNING *""",
            (patient['user_id'], kind, DEVICE_MODELS[kind]),
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                'UPDATE devices SET connected = TRUE WHERE patient_id = %s AND kind = %s RETURNING *',
                (patient['user_id'], kind),
            )
            row = cur.fetchone()
        audit(cur, 'device_connected', patient['user_id'], f"device:{row['id']}", request.remote_addr)
    return jsonify({'device': device_json(row)}), 201


def own_device(cur, patient, device_id):
    cur.execute('SELECT * FROM devices WHERE id = %s AND patient_id = %s', (device_id, patient['user_id']))
    return cur.fetchone()


@bp.post('/devices/<int:device_id>/sync')
@login_required('patient')
def sync_device(device_id):
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not own_device(cur, patient, device_id):
            return error('Устройство не найдено.', 404)
        cur.execute('UPDATE devices SET last_sync = now() WHERE id = %s RETURNING *', (device_id,))
        row = cur.fetchone()
        audit(cur, 'device_synced', patient['user_id'], f'device:{device_id}', request.remote_addr)
    return jsonify({'device': device_json(row)})


@bp.post('/devices/<int:device_id>/connected')
@login_required('patient')
def set_device_connected(device_id):
    connected = bool((request.get_json(silent=True) or {}).get('connected'))
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not own_device(cur, patient, device_id):
            return error('Устройство не найдено.', 404)
        cur.execute('UPDATE devices SET connected = %s WHERE id = %s RETURNING *', (connected, device_id))
        row = cur.fetchone()
        audit(cur, 'device_connected' if connected else 'device_disconnected', patient['user_id'],
              f'device:{device_id}', request.remote_addr)
    return jsonify({'device': device_json(row)})


@bp.post('/password')
@login_required('patient')
def change_password():
    user = current_user()
    data = request.get_json(silent=True) or {}
    current = str(data.get('currentPassword', ''))
    password = str(data.get('password', ''))
    sign_out_others = data.get('signOutOthers') is not False

    with db_cursor() as cur:
        patient = own_patient(cur)
        cur.execute('SELECT * FROM users WHERE id = %s', (user['id'],))
        row = cur.fetchone()
        if not row or not check_password_hash(row['password_hash'], current):
            return error('Неверный текущий пароль.')
        problem = password_problem(password, (
            row['phone'][-4:] if row['phone'] else None,
            row['phone'],
            row['email'],
            str(patient['birth_date'].year) if patient else None,
        ))
        if problem:
            return error(problem)
        if sign_out_others:
            cur.execute(
                """UPDATE users SET password_hash = %s, password_changed_at = now(), must_change_password = FALSE,
                          session_version = session_version + 1
                   WHERE id = %s RETURNING *""",
                (generate_password_hash(password), row['id']),
            )
        else:
            cur.execute(
                """UPDATE users SET password_hash = %s, password_changed_at = now(), must_change_password = FALSE
                   WHERE id = %s RETURNING *""",
                (generate_password_hash(password), row['id']),
            )
        updated = cur.fetchone()
        if row['phone']:
            send_sms(cur, row['phone'], 'HealthMonitor: пароль изменён. Если это были не вы, позвоните в клинику.')
        audit(cur, 'password_changed', row['id'], None, request.remote_addr, is_security=True)

    if sign_out_others:
        # Текущий сеанс продолжаем уже с новой версией
        start_session(updated)
    return jsonify({
        'ok': True,
        'othersSignedOut': sign_out_others,
        'passwordChangedAt': iso(updated['password_changed_at']),
    })


@bp.get('/reminders')
@login_required('patient')
def reminders():
    """Напоминания о лекарствах и замерах: что включено и можно ли добавить замер."""
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        cur.execute(
            """SELECT s.id, s.time_of_day, s.dose, s.enabled, m.name FROM medication_slots s
               JOIN medications m ON m.id = s.medication_id
               WHERE m.patient_id = %s ORDER BY s.time_of_day, s.id""",
            (patient['user_id'],),
        )
        medications = [{
            'id': row['id'],
            'title': row['name'],
            'subtitle': row['dose'],
            'time': row['time_of_day'].strftime('%H:%M'),
            'enabled': row['enabled'],
        } for row in cur.fetchall()]

        cur.execute(
            'SELECT id, kind, time_of_day, enabled FROM measurement_reminders WHERE patient_id = %s ORDER BY time_of_day',
            (patient['user_id'],),
        )
        measurements = [{
            'id': row['id'],
            'title': REMINDER_TITLES[row['kind']],
            'subtitle': 'каждый день',
            'time': row['time_of_day'].strftime('%H:%M'),
            'enabled': row['enabled'],
        } for row in cur.fetchall()]
        kind = NOSOLOGY_KIND[patient['nosology']]

    return jsonify({
        'kind': kind,
        'medications': medications,
        'measurements': measurements,
        'addOptions': [{'id': kind, 'label': KIND_TITLES[kind]}],
    })


@bp.post('/reminders/medications/<int:slot_id>')
@login_required('patient')
def set_medication_reminder(slot_id):
    enabled = bool((request.get_json(silent=True) or {}).get('enabled'))
    with db_cursor() as cur:
        patient = own_patient(cur)
        cur.execute(
            """SELECT s.id FROM medication_slots s JOIN medications m ON m.id = s.medication_id
               WHERE s.id = %s AND m.patient_id = %s""",
            (slot_id, patient['user_id'] if patient else None),
        )
        if not cur.fetchone():
            return error('Напоминание не найдено.', 404)
        cur.execute('UPDATE medication_slots SET enabled = %s WHERE id = %s', (enabled, slot_id))
        audit(cur, 'reminder_changed', patient['user_id'], f'slot:{slot_id}', request.remote_addr)
    return jsonify({'enabled': enabled})


@bp.post('/reminders/measurements')
@login_required('patient')
def add_measurement_reminder():
    data = request.get_json(silent=True) or {}
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        expected = NOSOLOGY_KIND[patient['nosology']]
        if data.get('kind') != expected:
            return error('Можно добавить напоминание только о своём показателе.')
        time_text = str(data.get('time', '')).strip()
        if not REMINDER_TIME.match(time_text):
            return error('Укажите время в формате ЧЧ:ММ.')
        cur.execute(
            """INSERT INTO measurement_reminders (patient_id, kind, time_of_day) VALUES (%s, %s, %s)
               RETURNING id""",
            (patient['user_id'], expected, time_text),
        )
        reminder_id = cur.fetchone()['id']
        audit(cur, 'reminder_added', patient['user_id'], f'reminder:{reminder_id}', request.remote_addr)
    return jsonify({
        'reminder': {
            'id': reminder_id,
            'title': REMINDER_TITLES[expected],
            'subtitle': 'каждый день',
            'time': time_text,
            'enabled': True,
        },
    }), 201


@bp.post('/reminders/measurements/<int:reminder_id>')
@login_required('patient')
def set_measurement_reminder(reminder_id):
    enabled = bool((request.get_json(silent=True) or {}).get('enabled'))
    with db_cursor() as cur:
        patient = own_patient(cur)
        cur.execute(
            'UPDATE measurement_reminders SET enabled = %s WHERE id = %s AND patient_id = %s RETURNING id',
            (enabled, reminder_id, patient['user_id'] if patient else None),
        )
        if not cur.fetchone():
            return error('Напоминание не найдено.', 404)
        audit(cur, 'reminder_changed', patient['user_id'], f'reminder:{reminder_id}', request.remote_addr)
    return jsonify({'enabled': enabled})


def parse_number(value):
    text = str(value if value is not None else '').strip().replace(',', '.')
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def entry_error(kind, value, value2):
    if kind == 'glucose':
        if value is None or not RANGES['glucose'][0] <= value <= RANGES['glucose'][1]:
            return 'Введите значение от 1 до 35 ммоль/л.'
    elif kind == 'pef':
        if value is None or not RANGES['pef'][0] <= value <= RANGES['pef'][1]:
            return 'Введите значение от 50 до 900 л/мин.'
    else:
        sys_range, dia_range = RANGES['bp']
        if (value is None or value2 is None or not sys_range[0] <= value <= sys_range[1]
                or not dia_range[0] <= value2 <= dia_range[1] or value2 >= value):
            return 'Верхнее 60–260, нижнее 30–160 и меньше верхнего.'
    return None


@bp.post('/measurements')
@login_required('patient')
def add_measurement():
    user = current_user()
    data = request.get_json(silent=True) or {}
    kind = data.get('kind')
    if kind not in KIND_TITLES:
        return error('Выберите, что измеряли.')
    value = parse_number(data.get('value'))
    value2 = parse_number(data.get('value2')) if kind == 'bp' else None
    problem = entry_error(kind, value, value2)
    if problem:
        return error(problem)
    context = data.get('context') if data.get('context') in CONTEXT_TITLES else None
    wellbeing = [item for item in (data.get('wellbeing') or []) if item in WELLBEING]

    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        measurement, alert = record_measurement(cur, patient, kind, value, value2, 'manual',
                                                context=context, wellbeing=wellbeing)
        level = evaluate(measurement, load_thresholds(cur, patient), patient['pef_best'])[0]
        audit(cur, 'measurement_added', user['id'], f"measurement:{measurement['id']}", request.remote_addr)

    return jsonify({
        'measurement': {
            'id': measurement['id'],
            'value': fmt_value(measurement),
            'unit': UNITS[kind],
            'level': level,
            'measuredAt': iso(measurement['measured_at']),
        },
        'alert': alert and {
            'id': alert['id'],
            'level': alert['level'],
            'rule': alert['rule'],
            'createdAt': iso(alert['created_at']),
        },
    }), 201


def threshold_text(kind, thresholds, patient):
    if kind == 'glucose':
        low, high = thresholds['glucose']['crit_low'], thresholds['glucose']['crit_high']
        if low is not None and high is not None:
            return f'ниже {fmt_number(low, "glucose")} или выше {fmt_number(high, "glucose")} ммоль/л'
        limit = low if low is not None else high
        if limit is None:
            return 'не задан'
        return f'{fmt_number(limit, "glucose")} ммоль/л'
    if kind == 'bp':
        sys_limits, dia_limits = thresholds['bp_sys'], thresholds['bp_dia']
        low = fmt_number(sys_limits['crit_low'], 'bp') if sys_limits['crit_low'] is not None else '—'
        high = fmt_number(sys_limits['crit_high'], 'bp') if sys_limits['crit_high'] is not None else '—'
        dia = fmt_number(dia_limits['crit_high'], 'bp') if dia_limits['crit_high'] is not None else '—'
        return f'выше {high}/{dia} мм рт. ст., ниже — {low}/—'
    percent = thresholds['pef']['crit_low']
    text = f'ниже {fmt_number(percent, "pef")}% от лучшего' if percent is not None else 'не задан'
    if patient['pef_best'] and percent is not None:
        text += f' ({fmt_number(patient["pef_best"] * percent / 100, "pef")} л/мин)'
    return text


@bp.get('/measurements')
@login_required('patient')
def history():
    """История измерений за 7 или 14 дней: график, средние и таблица."""
    days = request.args.get('days', type=int) or 14
    if days not in (7, 14):
        return error('Период: 7 или 14 дней.')
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        thresholds = load_thresholds(cur, patient)
        kind = NOSOLOGY_KIND[patient['nosology']]
        cur.execute(
            """SELECT * FROM measurements WHERE patient_id = %s
               AND measured_at > now() - make_interval(days => %s) ORDER BY measured_at""",
            (patient['user_id'], days),
        )
        rows = cur.fetchall()

    return jsonify({
        'days': days,
        'kind': kind,
        'kindTitle': KIND_TITLES[kind],
        'target': target_text(patient, thresholds),
        'chart': chart_payload(patient, rows, thresholds),
        'stats': stats_payload(kind, rows, thresholds, patient['pef_best']),
        'measurements': [measurement_card(row, thresholds, patient) for row in reversed(rows)],
    })


@bp.get('/chat')
@login_required('patient')
def chat_thread():
    """Переписка с врачом и последний критический алерт для системного сообщения."""
    user = current_user()
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        cur.execute(
            'SELECT u.name, d.specialty FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = %s',
            (patient['doctor_id'],),
        )
        doctor = cur.fetchone()
        history = chat.messages_for(cur, patient['user_id'])
        chat.mark_read(cur, patient['user_id'], user['id'])
        cur.execute(
            """SELECT a.rule, a.created_at, m.value, m.value2, m.kind FROM alerts a
               LEFT JOIN measurements m ON m.id = a.measurement_id
               WHERE a.patient_id = %s AND a.level = 'crit'
               ORDER BY a.created_at DESC LIMIT 1""",
            (patient['user_id'],),
        )
        alert = cur.fetchone()
        audit(cur, 'chat_viewed', user['id'], f"patient:{patient['user_id']}", request.remote_addr)

    return jsonify({
        'doctor': {
            'name': short_name(doctor['name']) if doctor else None,
            'specialty': doctor['specialty'] if doctor else None,
            'hours': 'отвечает с 9:00 до 18:00',
        },
        'alert': alert and {
            'createdAt': iso(alert['created_at']),
            'value': fmt_value(alert) if alert['kind'] else None,
            'unit': UNITS[alert['kind']] if alert['kind'] else None,
            'rule': alert['rule'],
        },
        'messages': [chat.message_json(row, user['id']) for row in history],
    })


@bp.post('/chat')
@login_required('patient')
def chat_send():
    user = current_user()
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        try:
            row = chat.add_message(cur, patient['user_id'], user['id'],
                                   (request.get_json(silent=True) or {}).get('body'))
        except ValueError as e:
            return error(str(e))
        audit(cur, 'message_sent', user['id'], f"patient:{patient['user_id']}", request.remote_addr)
    return jsonify(chat.message_json(row, user['id'])), 201


@bp.get('/alerts/latest')
@login_required('patient')
def latest_alert():
    with db_cursor() as cur:
        patient = own_patient(cur)
        if not patient:
            return error('Карта пациента не заполнена. Позвоните в регистратуру.', 404)
        cur.execute(
            """SELECT a.*, m.value, m.value2, m.kind FROM alerts a
               LEFT JOIN measurements m ON m.id = a.measurement_id
               WHERE a.patient_id = %s AND a.level = 'crit'
               ORDER BY a.created_at DESC LIMIT 1""",
            (patient['user_id'],),
        )
        alert = cur.fetchone()
        if not alert:
            return error('Алертов нет.', 404)
        thresholds = load_thresholds(cur, patient)
        cur.execute('SELECT name FROM users WHERE id = %s', (patient['doctor_id'],))
        doctor = cur.fetchone()
        cur.execute('SELECT name, sms_alerts FROM patient_contacts WHERE patient_id = %s', (patient['user_id'],))
        contact = cur.fetchone()
        cur.execute(
            """SELECT body, created_at FROM messages
               WHERE patient_id = %s AND sender_id = %s ORDER BY created_at DESC LIMIT 1""",
            (patient['user_id'], patient['doctor_id']),
        )
        memo = cur.fetchone()

    relative = None
    if contact and contact['sms_alerts']:
        parts = [part.strip() for part in contact['name'].split(',')]
        relative = {'label': f'{parts[-1].capitalize()}, {short_name(parts[0])}'}
    return jsonify({
        'value': fmt_value(alert),
        'unit': UNITS[alert['kind']],
        'kind': alert['kind'],
        'level': alert['level'],
        'rule': alert['rule'],
        'threshold': threshold_text(alert['kind'], thresholds, patient),
        'createdAt': iso(alert['created_at']),
        'doctor': {'name': short_name(doctor['name'])} if doctor else None,
        'relative': relative,
        'relativeSmsAt': iso(alert['relative_sms_at']),
        'memo': memo and {'text': memo['body'], 'createdAt': iso(memo['created_at']),
                          'author': short_name(doctor['name']) if doctor else None},
    })
