from datetime import date

from flask import Blueprint, jsonify, request

from db import audit, db_cursor
from monitoring import (LEVEL_ORDER, NO_DATA_DAYS, NOSOLOGY_KIND, UNITS, ensure_no_data_alerts, evaluate, fmt_value,
                        load_thresholds, target_text)
from security import current_user, error, login_required, short_name

bp = Blueprint('doctor', __name__, url_prefix='/api/doctor')

DEVICE_KIND = {'glucose': 'glucometer', 'bp': 'tonometer', 'pef': 'peakflow'}


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
        cur.execute('SELECT name, sms_alerts FROM patient_contacts WHERE patient_id = %s', (patient_id,))
        contact = cur.fetchone()

    return jsonify({
        **patient_brief(patient),
        'alert': alert_json(alert),
        'measurements': [measurement_json(m, thresholds, patient['pef_best']) for m in measurements],
        'target': target_text(patient, thresholds),
        'device': device and {'kind': device['kind'], 'model': device['model'],
                              'connected': device['connected'], 'lastSync': iso(device['last_sync'])},
        'relative': contact and {'name': contact['name'], 'smsAlerts': contact['sms_alerts']},
    })


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
