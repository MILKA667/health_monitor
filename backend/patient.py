"""Экраны пациента: главная с планом на сегодня, ввод показателя и алерт."""
from datetime import date, datetime, timezone

from flask import Blueprint, jsonify, request

from db import audit, db_cursor
from monitoring import (NOSOLOGY_KIND, UNITS, evaluate, fmt_number, fmt_value, load_thresholds, record_measurement,
                        target_text)
from security import current_user, error, login_required, short_name

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
        """SELECT p.*, u.name, u.phone FROM patients p JOIN users u ON u.id = p.user_id
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
        'isToday': row['measured_at'].date() == date.today(),
    }


def plan_items(cur, patient):
    """План на сегодня: приёмы лекарств и замеры с отметками о выполнении."""
    today = date.today()
    items = []
    cur.execute(
        """SELECT s.id, s.time_of_day, s.dose, m.name FROM medication_slots s
           JOIN medications m ON m.id = s.medication_id
           WHERE m.patient_id = %s AND m.enabled
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
                (slot_id, date.today()),
            )
        else:
            cur.execute('DELETE FROM medication_intakes WHERE slot_id = %s AND taken_on = %s',
                        (slot_id, date.today()))
        audit(cur, 'medication_intake', patient['user_id'], f'slot:{slot_id}', request.remote_addr)
    return jsonify({'done': done})


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
            'escalateAt': iso(alert['escalate_at']),
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
        'escalateAt': iso(alert['escalate_at']),
        'escalated': alert['accepted_at'] is None and alert['escalate_at'] is not None
        and alert['escalate_at'] <= datetime.now(timezone.utc),
        'doctor': {'name': short_name(doctor['name'])} if doctor else None,
        'relative': relative,
        'relativeSmsAt': iso(alert['relative_sms_at']),
        'memo': memo and {'text': memo['body'], 'createdAt': iso(memo['created_at']),
                          'author': short_name(doctor['name']) if doctor else None},
    })
