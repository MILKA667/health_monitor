from datetime import date, timedelta
from decimal import Decimal
import math

from flask import Blueprint, jsonify, request

import chat
from db import audit, db_cursor
from monitoring import (LEVEL_ORDER, NO_DATA_DAYS, NOSOLOGY_KIND, THRESHOLD_FIELDS, UNITS, ensure_no_data_alerts,
                        evaluate, fmt_number, fmt_value, load_settings, load_thresholds, target_text)
from security import current_user, error, login_required, mask_phone, short_name

bp = Blueprint('doctor', __name__, url_prefix='/api/doctor')

DEVICE_KIND = {'glucose': 'glucometer', 'bp': 'tonometer', 'pef': 'peakflow'}
DEVICE_LABEL = {'glucose': 'глюкометр', 'bp': 'тонометр', 'pef': 'пикфлоуметр'}
SEX_LABEL = {'м': 'муж.', 'ж': 'жен.'}
CONTEXT_LABEL = {'fast': 'натощак', 'after': 'через 2 часа после еды', 'night': 'перед сном'}
CHART_TITLES = {'glucose': 'Глюкоза крови, ммоль/л', 'bp': 'Артериальное давление, мм рт. ст.',
                'pef': 'ПСВ, % от лучшего результата'}
PERIOD_DAYS = (7, 14, 30)
ADHERENCE_DAYS = 14



def iso(value):
    return value.isoformat() if value else None


def age(birth_date):
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def alert_json(alert):
    if not alert:
        return None
    return {
        'id': alert['id'],
        'level': alert['level'],
        'rule': alert['rule'],
        'createdAt': iso(alert['created_at']),
        'escalateAt': iso(alert['escalate_at']),
        'escalated': alert['escalated'],
        'acceptedAt': iso(alert['accepted_at']),
        'acceptedBy': short_name(alert['accepted_by_name']) if alert['accepted_by_name'] else None,
        'acceptedByMe': alert['accepted_by'] == current_user()['id'],
        'comment': alert['comment'],
        'relativeSmsAt': iso(alert['relative_sms_at']),
    }


ALERT_SELECT = """
    SELECT a.*, u.name AS accepted_by_name,
           COALESCE(a.accepted_at IS NULL AND a.escalate_at <= now(), FALSE) AS escalated
    FROM alerts a LEFT JOIN users u ON u.id = a.accepted_by
"""


def measurement_json(measurement, thresholds, pef_best):
    level, deviation, _ = evaluate(measurement, thresholds, pef_best)
    return {
        'id': measurement['id'],
        'value': fmt_value(measurement),
        'unit': UNITS[measurement['kind']],
        'level': level,
        'deviation': deviation,
        'source': measurement['source'],
        'measuredAt': iso(measurement['measured_at']),
    }


def patient_brief(row):
    return {
        'id': row['user_id'],
        'name': row['name'],
        'age': age(row['birth_date']),
        'policyTail': row['policy'][-4:] if row['policy'] else None,
        'nosology': row['nosology'],
    }


def own_patient(cur, patient_id):
    cur.execute(
        """SELECT p.*, u.name FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.user_id = %s AND p.doctor_id = %s""",
        (patient_id, current_user()['id']),
    )
    return cur.fetchone()


def open_crit_count(cur, doctor_id):
    cur.execute(
        """SELECT count(*) AS n FROM alerts a JOIN patients p ON p.user_id = a.patient_id
           WHERE p.doctor_id = %s AND a.level = 'crit' AND a.accepted_at IS NULL""",
        (doctor_id,),
    )
    return cur.fetchone()['n']


@bp.get('/header')
@login_required('doctor')
def header():
    user = current_user()
    with db_cursor() as cur:
        cur.execute('SELECT specialty FROM doctors WHERE user_id = %s', (user['id'],))
        doctor = cur.fetchone()
        count = open_crit_count(cur, user['id'])
    return jsonify({
        'name': short_name(user['name']),
        'specialty': doctor['specialty'] if doctor else None,
        'openAlerts': count,
    })


@bp.get('/worklist')
@login_required('doctor')
def worklist():
    """Пациенты врача с последним показателем. Группа: уровень последнего измерения или «нет данных»."""
    doctor_id = current_user()['id']
    with db_cursor() as cur:
        ensure_no_data_alerts(cur, doctor_id)
        cur.execute(
            """SELECT p.*, u.name, m.*, m.id AS measurement_id,
                      m.measured_at < now() - make_interval(days => %s) AS stale
               FROM patients p
               JOIN users u ON u.id = p.user_id
               LEFT JOIN LATERAL (
                   SELECT * FROM measurements WHERE patient_id = p.user_id ORDER BY measured_at DESC LIMIT 1
               ) m ON TRUE
               WHERE p.doctor_id = %s
               ORDER BY u.name""",
            (NO_DATA_DAYS, doctor_id),
        )
        rows = cur.fetchall()

        cur.execute(
            ALERT_SELECT + """WHERE a.measurement_id = ANY(%s) AND a.level = 'crit'""",
            ([row['measurement_id'] for row in rows if row['measurement_id']],),
        )
        alerts = {alert['measurement_id']: alert for alert in cur.fetchall()}

        patients = []
        for row in rows:
            item = patient_brief(row)
            if row['measurement_id']:
                measurement = {**row, 'id': row['measurement_id']}
                last = measurement_json(measurement, load_thresholds(cur, row), row['pef_best'])
                item['last'] = last
                item['level'] = 'none' if row['stale'] else last['level']
                item['alert'] = alert_json(alerts.get(row['measurement_id']))
            else:
                item.update(last=None, level='none', alert=None)
            patients.append(item)

    patients.sort(key=lambda item: LEVEL_ORDER[item['level']])
    return jsonify({'patients': patients})


@bp.get('/patients/<int:patient_id>/summary')
@login_required('doctor')
def summary(patient_id):
    with db_cursor() as cur:
        patient = own_patient(cur, patient_id)
        if not patient:
            return error('Пациент не найден.', 404)
        thresholds = load_thresholds(cur, patient)

        cur.execute(
            'SELECT * FROM measurements WHERE patient_id = %s ORDER BY measured_at DESC LIMIT 4',
            (patient_id,),
        )
        measurements = cur.fetchall()

        alert = None
        if measurements:
            cur.execute(ALERT_SELECT + "WHERE a.measurement_id = %s AND a.level = 'crit'", (measurements[0]['id'],))
            alert = cur.fetchone()

        cur.execute(
            'SELECT * FROM devices WHERE patient_id = %s AND kind = %s ORDER BY id DESC LIMIT 1',
            (patient_id, DEVICE_KIND[NOSOLOGY_KIND[patient['nosology']]]),
        )
        device = cur.fetchone()
        cur.execute('SELECT name, phone, sms_alerts FROM patient_contacts WHERE patient_id = %s', (patient_id,))
        contact = cur.fetchone()

    return jsonify({
        **patient_brief(patient),
        'alert': alert_json(alert),
        'measurements': [measurement_json(m, thresholds, patient['pef_best']) for m in measurements],
        'target': target_text(patient, thresholds),
        'device': device and {'kind': device['kind'], 'model': device['model'],
                              'connected': device['connected'], 'lastSync': iso(device['last_sync'])},
        'relative': contact and {'name': contact['name'], 'smsAlerts': contact['sms_alerts'],
                                 'phoneMasked': mask_phone(contact['phone'])},
    })


def chart_guide(value, tone, label=None):
    return {'value': float(value) if value is not None else None, 'tone': tone, 'label': label}


def point(measured_at, value, level):
    return {'date': measured_at.isoformat(), 'value': float(value), 'level': level}


def nice_domain(lo, hi):
    """Округляет пределы графика до «круглых» значений, на которых читаются подписи оси."""
    lo, hi = float(lo), float(hi)
    if hi <= lo:
        hi = lo + 1
    rough = (hi - lo) / 4
    magnitude = 10 ** math.floor(math.log10(rough))
    step = 10 * magnitude
    for factor in (1, 2, 2.5, 5, 10):
        if factor * magnitude >= rough:
            step = factor * magnitude
            break
    return math.floor(lo / step) * step, math.ceil(hi / step) * step


def chart_payload(patient, measurements, thresholds):
    """Данные графика: точки по дням, полоса цели и пунктирные пороги."""
    kind = NOSOLOGY_KIND[patient['nosology']]
    best = patient['pef_best']
    series = []
    if kind == 'bp':
        series.append({'id': 'sys', 'label': 'Верхнее', 'points': [
            point(m['measured_at'], m['value'], evaluate(m, thresholds, best)[0]) for m in measurements]})
        series.append({'id': 'dia', 'label': 'Нижнее', 'points': [
            point(m['measured_at'], m['value2'], evaluate(m, thresholds, best)[0]) for m in measurements]})
        band = (thresholds['bp_sys']['warn_low'], thresholds['bp_sys']['warn_high'])
        guides = [chart_guide(thresholds['bp_sys']['crit_low'], 'crit'),
                  chart_guide(thresholds['bp_sys']['crit_high'], 'crit')]
        tick_format = lambda value: fmt_number(value, 'bp')
    elif kind == 'pef':
        if best:
            series.append({'id': 'pef', 'label': None, 'points': [
                point(m['measured_at'], Decimal(m['value']) * 100 / best, evaluate(m, thresholds, best)[0])
                for m in measurements]})
        band = (thresholds['pef']['warn_low'], Decimal(100))
        guides = [chart_guide(thresholds['pef']['crit_low'], 'crit')]
        tick_format = lambda value: f'{fmt_number(value, "pef")}%'
    else:
        series.append({'id': 'glucose', 'label': None, 'points': [
            point(m['measured_at'], m['value'], evaluate(m, thresholds, best)[0]) for m in measurements]})
        band = (thresholds['glucose']['warn_low'], thresholds['glucose']['warn_high'])
        guides = [chart_guide(thresholds['glucose']['crit_low'], 'crit')]
        tick_format = lambda value: fmt_number(value, 'glucose')

    guide_values = [Decimal(guide['value']) for guide in guides if guide['value'] is not None]
    band_values = [Decimal(value) for value in band if value is not None]
    values = [Decimal(p['value']) for item in series for p in item['points']] + guide_values + band_values
    lo, hi = nice_domain(min(values), max(values))
    if kind == 'pef':
        lo = max(0.0, lo)

    step = (hi - lo) / 4
    ticks = [lo + step * i for i in range(5)]
    for guide in guides:
        if guide['value'] is not None:
            guide['label'] = tick_format(guide['value'])

    return {
        'title': CHART_TITLES[kind],
        'series': series,
        'domain': [round(lo, 2), round(hi, 2)],
        'yTicks': [{'value': round(tick, 2), 'label': tick_format(tick)} for tick in ticks],
        'bands': [{'from': float(band[0]), 'to': float(band[1])}] if all(v is not None for v in band) else [],
        'guides': guides,
        'firstDate': measurements[0]['measured_at'].isoformat() if measurements else None,
        'lastDate': measurements[-1]['measured_at'].isoformat() if measurements else None,
    }


def level_tone(level):
    return None if level == 'ok' else level


def stats_payload(kind, entries, thresholds, best):
    """Среднее, минимум, максимум и число значений вне цели за период."""
    if not entries:
        return []

    levels = [evaluate(row, thresholds, best)[0] for row in entries]
    out = sum(1 for level in levels if level != 'ok')

    def value_of(row):
        if kind == 'bp':
            return f"{fmt_number(row['value'], 'bp')}/{fmt_number(row['value2'], 'bp')}"
        if kind == 'pef' and best:
            return f'{fmt_number(Decimal(row["value"]) * 100 / best, "pef")}%'
        return fmt_number(row['value'], kind)

    def number_of(row):
        if kind == 'bp':
            return Decimal(row['value'])
        if kind == 'pef' and best:
            return Decimal(row['value']) * 100 / best
        return Decimal(row['value'])

    if kind == 'bp':
        average = (f"{fmt_number(sum(Decimal(r['value']) for r in entries) / len(entries), 'bp')}/"
                   f"{fmt_number(sum(Decimal(r['value2']) for r in entries) / len(entries), 'bp')}")
    elif kind == 'pef' and best:
        average = f'{fmt_number(sum(number_of(r) for r in entries) / len(entries), "pef")}%'
    else:
        average = fmt_number(sum(number_of(r) for r in entries) / len(entries), kind)

    lowest = min(range(len(entries)), key=lambda i: number_of(entries[i]))
    highest = max(range(len(entries)), key=lambda i: number_of(entries[i]))
    return [
        {'label': 'Среднее', 'value': average},
        {'label': 'Мин.', 'value': value_of(entries[lowest]), 'tone': level_tone(levels[lowest])},
        {'label': 'Макс.', 'value': value_of(entries[highest]), 'tone': level_tone(levels[highest])},
        {'label': 'Вне цели', 'value': f'{out} из {len(entries)}'},
    ]


def threshold_text(limits, metric):
    def fmt(value):
        return fmt_number(value, metric) if value is not None else '—'
    low, high = limits['crit_low'], limits['crit_high']
    if low is None:
        return f'выше {fmt(high)}' if high is not None else 'не задан'
    if high is None:
        return f'ниже {fmt(low)}'
    return f'ниже {fmt(low)} или выше {fmt(high)}'


def thresholds_payload(patient, thresholds):
    kind = NOSOLOGY_KIND[patient['nosology']]
    best = patient['pef_best']
    if kind == 'pef':
        percent = thresholds['pef']['warn_low']
        goal = (f'{fmt_number(percent, "pef")}% и выше'
                + (f' ({fmt_number(best * percent / 100, "pef")} л/мин)' if best and percent is not None else '')
                + ('' if best else ' — лучший результат не указан'))
        return [
            {'label': 'Критический порог', 'value': threshold_text(thresholds['pef'], 'pef') + ' от лучшего'},
            {'label': 'Цель', 'value': goal},
        ]
    if kind == 'bp':
        limits = thresholds['bp_sys']
        dia = thresholds['bp_dia']
        return [
            {'label': 'Критический порог',
             'value': f"{threshold_text(limits, 'bp')} / {threshold_text(dia, 'bp')} мм рт. ст."},
            {'label': 'Цель', 'value': target_text(patient, thresholds)},
        ]
    limits = thresholds['glucose']
    return [
        {'label': 'Критический порог', 'value': threshold_text(limits, 'glucose') + ' ммоль/л'},
        {'label': 'Цель', 'value': target_text(patient, thresholds)},
    ]


def measurement_context(context):
    return CONTEXT_LABEL.get(context, context) if context else '—'


def record_measurement_json(measurement, thresholds, best):
    item = measurement_json(measurement, thresholds, best)
    item['context'] = measurement_context(measurement['context'])
    item['sourceLabel'] = DEVICE_LABEL[measurement['kind']] if measurement['source'] == 'device' else 'вручную'
    return item


def iso_date(value):
    return value.isoformat() if value else None


@bp.get('/patients/<int:patient_id>/record')
@login_required('doctor')
def record(patient_id):
    """Медкарта: шапка, алерт, график, измерения и пороги за выбранный период."""
    days = request.args.get('days', type=int) or 14
    if days not in PERIOD_DAYS:
        return error('Период: 7, 14 или 30 дней.')
    user = current_user()
    with db_cursor() as cur:
        patient = own_patient(cur, patient_id)
        if not patient:
            return error('Пациент не найден.', 404)
        thresholds = load_thresholds(cur, patient)
        settings = load_settings(cur, patient)

        cur.execute(
            """SELECT * FROM measurements WHERE patient_id = %s AND measured_at > now() - make_interval(days => %s)
               ORDER BY measured_at""",
            (patient_id, days),
        )
        measurements = cur.fetchall()

        latest_alert = None
        if measurements:
            # Полоса алерта — по последнему измерению; если он в норме, показываем открытый критический
            cur.execute(ALERT_SELECT + "WHERE a.measurement_id = %s AND a.level = 'crit'", (measurements[-1]['id'],))
            latest_alert = cur.fetchone()
            if not latest_alert:
                cur.execute(
                    ALERT_SELECT + """WHERE a.patient_id = %s AND a.level = 'crit' AND a.accepted_at IS NULL
                                      ORDER BY a.created_at DESC LIMIT 1""",
                    (patient_id,),
                )
                latest_alert = cur.fetchone()

        cur.execute(
            """SELECT * FROM devices WHERE patient_id = %s AND kind = %s ORDER BY id DESC LIMIT 1""",
            (patient_id, DEVICE_KIND[NOSOLOGY_KIND[patient['nosology']]]),
        )
        device = cur.fetchone()
        cur.execute('SELECT name, phone, sms_alerts FROM patient_contacts WHERE patient_id = %s', (patient_id,))
        contact = cur.fetchone()
        cur.execute(
            """SELECT max(given_at) AS given_at FROM consents
               WHERE user_id = %s AND kind = 'personal_data' AND revoked_at IS NULL""",
            (patient_id,),
        )
        consent = cur.fetchone()

        audit(cur, 'record_viewed', user['id'], f'patient:{patient_id}', request.remote_addr)
    latest = measurements[-1] if measurements else None
    return jsonify({
        **patient_brief(patient),
        'sex': SEX_LABEL.get(patient['sex']),
        'diagnosis': patient['diagnosis'],
        'icdCode': patient['icd_code'],
        'enrolledAt': iso_date(patient['enrolled_at']),
        'consentAt': iso(consent['given_at']) if consent else None,
        'device': device and {'kind': device['kind'], 'model': device['model'],
                              'connected': device['connected'], 'lastSync': iso(device['last_sync'])},
        'relative': contact and {'name': contact['name'], 'smsAlerts': contact['sms_alerts'],
                                 'phoneMasked': mask_phone(contact['phone'])},
        'alert': alert_json(latest_alert),
        'days': days,
        'chart': chart_payload(patient, measurements, thresholds),
        'stats': stats_payload(NOSOLOGY_KIND[patient['nosology']], measurements, thresholds, patient['pef_best']),
        'measurements': [record_measurement_json(m, thresholds, patient['pef_best']) for m in reversed(measurements)],
        'thresholds': thresholds_payload(patient, thresholds),
        'escalationMinutes': settings['escalation_minutes'],
        'lastMeasurementAt': iso(latest['measured_at']) if latest else None,
    })


@bp.get('/patients/<int:patient_id>/medications')
@login_required('doctor')
def medications(patient_id):
    """Приверженность за 14 дней: сколько приёмов отмечено из ожидаемых."""
    start = date.today() - timedelta(days=ADHERENCE_DAYS - 1)
    with db_cursor() as cur:
        if not own_patient(cur, patient_id):
            return error('Пациент не найден.', 404)
        cur.execute('SELECT * FROM medications WHERE patient_id = %s ORDER BY prescribed_at, id', (patient_id,))
        rows = cur.fetchall()
        result = []
        for medication in rows:
            cur.execute(
                'SELECT id, time_of_day, dose FROM medication_slots WHERE medication_id = %s ORDER BY time_of_day',
                (medication['id'],),
            )
            slots = cur.fetchall()
            cur.execute(
                """SELECT count(*) AS taken, max(mi.taken_at) AS last
                   FROM medication_intakes mi JOIN medication_slots ms ON ms.id = mi.slot_id
                   WHERE ms.medication_id = %s AND mi.taken_on >= %s""",
                (medication['id'], start),
            )
            intake = cur.fetchone()
            window_start = max(start, medication['prescribed_at'])
            days = (date.today() - window_start).days + 1 if window_start <= date.today() else 0
            expected = days * len(slots)
            result.append({
                'id': medication['id'],
                'name': medication['name'],
                'schedule': medication['schedule'],
                'dose': ' · '.join(f'{slot["dose"]} в {slot["time_of_day"].strftime("%H:%M")}' for slot in slots),
                'prescribedAt': iso_date(medication['prescribed_at']),
                'enabled': medication['enabled'],
                'taken': intake['taken'],
                'expected': expected,
                'percent': round(intake['taken'] * 100 / expected) if expected else None,
                'lastTakenAt': iso(intake['last']),
            })
    return jsonify({'days': ADHERENCE_DAYS, 'medications': result})


@bp.get('/patients/<int:patient_id>/messages')
@login_required('doctor')
def messages(patient_id):
    user = current_user()
    with db_cursor() as cur:
        if not own_patient(cur, patient_id):
            return error('Пациент не найден.', 404)
        history = chat.messages_for(cur, patient_id)
        chat.mark_read(cur, patient_id, user['id'])
        audit(cur, 'messages_viewed', user['id'], f'patient:{patient_id}', request.remote_addr)
    return jsonify({'messages': [chat.message_json(row, user['id']) for row in history]})


@bp.post('/patients/<int:patient_id>/messages')
@login_required('doctor')
def send_message(patient_id):
    user = current_user()
    with db_cursor() as cur:
        if not own_patient(cur, patient_id):
            return error('Пациент не найден.', 404)
        try:
            row = chat.add_message(cur, patient_id, user['id'], (request.get_json(silent=True) or {}).get('body'))
        except ValueError as e:
            return error(str(e))
        audit(cur, 'message_sent', user['id'], f'patient:{patient_id}', request.remote_addr)
    return jsonify(chat.message_json(row, user['id'])), 201


@bp.get('/patients/<int:patient_id>/alerts')
@login_required('doctor')
def patient_alerts(patient_id):
    """Журнал алертов пациента с тем, кто был уведомлён и как отреагировали."""
    with db_cursor() as cur:
        if not own_patient(cur, patient_id):
            return error('Пациент не найден.', 404)
        cur.execute(
            """SELECT a.*, m.value, m.value2, m.kind, u.name AS accepted_by_name,
                      COALESCE(a.accepted_at IS NULL AND a.escalate_at <= now(), FALSE) AS escalated
               FROM alerts a
               LEFT JOIN measurements m ON m.id = a.measurement_id
               LEFT JOIN users u ON u.id = a.accepted_by
               WHERE a.patient_id = %s
               ORDER BY a.created_at DESC
               LIMIT 100""",
            (patient_id,),
        )
        rows = cur.fetchall()
    return jsonify({'alerts': [{
        'id': row['id'],
        'createdAt': iso(row['created_at']),
        'level': row['level'],
        'rule': row['rule'],
        'value': fmt_value(row) if row['kind'] else None,
        'unit': UNITS[row['kind']] if row['kind'] else None,
        'relativeSmsAt': iso(row['relative_sms_at']),
        'acceptedAt': iso(row['accepted_at']),
        'acceptedBy': short_name(row['accepted_by_name']) if row['accepted_by_name'] else None,
        'acceptedByMe': row['accepted_by'] == current_user()['id'],
        'escalateAt': iso(row['escalate_at']),
        'escalated': row['escalated'],
    } for row in rows]})


def load_alert_for_action(cur, alert_id):
    """Принять алерт может лечащий врач пациента, а эскалированный — ещё и дежурный."""
    cur.execute(
        ALERT_SELECT + """JOIN patients p ON p.user_id = a.patient_id
                          WHERE a.id = %s FOR UPDATE OF a""",
        (alert_id,),
    )
    alert = cur.fetchone()
    if not alert:
        return None
    user_id = current_user()['id']
    cur.execute('SELECT doctor_id FROM patients WHERE user_id = %s', (alert['patient_id'],))
    if cur.fetchone()['doctor_id'] == user_id:
        return alert
    cur.execute('SELECT on_duty FROM doctors WHERE user_id = %s', (user_id,))
    duty = cur.fetchone()
    return alert if alert['escalated'] and duty and duty['on_duty'] else None


@bp.post('/alerts/<int:alert_id>/accept')
@login_required('doctor')
def accept_alert(alert_id):
    comment = str((request.get_json(silent=True) or {}).get('comment', '')).strip() or None
    user = current_user()
    with db_cursor() as cur:
        alert = load_alert_for_action(cur, alert_id)
        if not alert:
            return error('Алерт не найден.', 404)
        if alert['accepted_at']:
            return error('Алерт уже принят.', 409)
        cur.execute(
            'UPDATE alerts SET accepted_at = now(), accepted_by = %s, comment = %s WHERE id = %s',
            (user['id'], comment, alert_id),
        )
        audit(cur, 'alert_accepted', user['id'], f'alert:{alert_id}', request.remote_addr)
        cur.execute(ALERT_SELECT + 'WHERE a.id = %s', (alert_id,))
        alert = cur.fetchone()
    return jsonify(alert_json(alert))


@bp.post('/alerts/<int:alert_id>/undo')
@login_required('doctor')
def undo_alert(alert_id):
    user = current_user()
    with db_cursor() as cur:
        alert = load_alert_for_action(cur, alert_id)
        if not alert:
            return error('Алерт не найден.', 404)
        if alert['accepted_by'] != user['id']:
            return error('Отменить принятие может только тот, кто принял алерт.', 403)
        cur.execute('UPDATE alerts SET accepted_at = NULL, accepted_by = NULL, comment = NULL WHERE id = %s', (alert_id,))
        audit(cur, 'alert_accept_undone', user['id'], f'alert:{alert_id}', request.remote_addr)
        cur.execute(ALERT_SELECT + 'WHERE a.id = %s', (alert_id,))
        alert = cur.fetchone()
    return jsonify(alert_json(alert))
