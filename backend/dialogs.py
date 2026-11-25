"""Диалоги врача с пациентами: список переписок, непрочитанные и последний показатель."""
from flask import Blueprint, jsonify, request

from db import audit, db_cursor
from monitoring import UNITS, evaluate, fmt_value, load_thresholds
from security import current_user, login_required, short_name

bp = Blueprint('dialogs', __name__, url_prefix='/api/doctor')

DIALOGS_SQL = """
    SELECT p.user_id, p.diagnosis, p.nosology, p.pef_best, u.name,
           lm.body AS last_body, lm.created_at AS last_at, lm.sender_id AS last_sender,
           (SELECT count(*) FROM messages m
             WHERE m.patient_id = p.user_id AND m.sender_id <> %s AND m.read_at IS NULL) AS unread,
           meas.value, meas.value2, meas.kind, meas.measured_at,
           al.rule AS alert_rule, al.created_at AS alert_at, al.relative_sms_at, al.escalate_at,
           COALESCE(al.escalated, FALSE) AS escalated,
           am.kind AS alert_kind, am.value AS alert_value, am.value2 AS alert_value2
    FROM patients p
    JOIN users u ON u.id = p.user_id
    JOIN LATERAL (
        SELECT m.body, m.created_at, m.sender_id FROM messages m
        WHERE m.patient_id = p.user_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
        SELECT * FROM measurements WHERE patient_id = p.user_id ORDER BY measured_at DESC LIMIT 1
    ) meas ON TRUE
    LEFT JOIN LATERAL (
        SELECT a.*, COALESCE(a.accepted_at IS NULL AND a.escalate_at <= now(), FALSE) AS escalated
        FROM alerts a
        WHERE a.patient_id = p.user_id AND a.level = 'crit'
        ORDER BY a.created_at DESC LIMIT 1
    ) al ON TRUE
    LEFT JOIN measurements am ON am.id = al.measurement_id
    WHERE p.doctor_id = %s
    ORDER BY lm.created_at DESC, p.user_id
"""


def iso(value):
    return value.isoformat() if value else None


@bp.get('/messages')
@login_required('doctor')
def dialogs():
    user = current_user()
    with db_cursor() as cur:
        cur.execute(DIALOGS_SQL, (user['id'], user['id']))
        rows = cur.fetchall()
        thresholds = {row['user_id']: load_thresholds(cur, row) for row in rows}
        audit(cur, 'messages_viewed', user['id'], None, request.remote_addr)

    conversations = []
    for row in rows:
        last_measurement = None
        if row['kind']:
            last_measurement = {
                'value': fmt_value(row),
                'unit': UNITS[row['kind']],
                'level': evaluate(row, thresholds[row['user_id']], row['pef_best'])[0],
                'measuredAt': iso(row['measured_at']),
            }
        alert = None
        if row['alert_at']:
            alert = {
                'rule': row['alert_rule'],
                'createdAt': iso(row['alert_at']),
                'value': fmt_value({'kind': row['alert_kind'], 'value': row['alert_value'],
                                    'value2': row['alert_value2']}) if row['alert_kind'] else None,
                'unit': UNITS[row['alert_kind']] if row['alert_kind'] else None,
                'relativeSmsAt': iso(row['relative_sms_at']),
                'escalateAt': iso(row['escalate_at']),
                'escalated': row['escalated'],
            }
        conversations.append({
            'patientId': row['user_id'],
            'name': row['name'],
            'shortName': short_name(row['name']),
            'diagnosis': row['diagnosis'],
            'unread': row['unread'],
            'lastMessage': {
                'body': row['last_body'],
                'mine': row['last_sender'] == user['id'],
                'createdAt': iso(row['last_at']),
            },
            'lastMeasurement': last_measurement,
            'alert': alert,
        })
    return jsonify({'conversations': conversations})
