"""Экран родственника: показатели и алерты близкого без доступа к переписке."""
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from db import audit, db_cursor
from monitoring import UNITS, evaluate, fmt_value, load_thresholds
from security import current_user, error, login_required, mask_phone, short_name

bp = Blueprint('relative', __name__, url_prefix='/api/relative')


def iso(value):
    return value.isoformat() if value else None


def linked_patient(cur):
    user = current_user()
    cur.execute(
        """SELECT p.*, u.name, u.phone, l.push_enabled, du.name AS doctor_name
           FROM relative_links l
           JOIN patients p ON p.user_id = l.patient_id
           JOIN users u ON u.id = p.user_id
           JOIN users du ON du.id = p.doctor_id
           WHERE l.relative_id = %s""",
        (user['id'],),
    )
    return cur.fetchone()


def relation_of(contact_name):
    parts = [part.strip() for part in (contact_name or '').split(',')]
    return parts[-1] if len(parts) > 1 else None


@bp.get('/home')
@login_required('relative')
def home():
    user = current_user()
    with db_cursor() as cur:
        patient = linked_patient(cur)
        if not patient:
            return error('Доступ к показателям не открыт. Обратитесь в клинику.', 404)
        thresholds = load_thresholds(cur, patient)

        cur.execute(
            """SELECT a.*, m.value, m.value2, m.kind, acc.name AS accepted_by_name
               FROM alerts a
               LEFT JOIN measurements m ON m.id = a.measurement_id
               LEFT JOIN users acc ON acc.id = a.accepted_by
               WHERE a.patient_id = %s AND a.level = 'crit'
               ORDER BY a.created_at DESC LIMIT 1""",
            (patient['user_id'],),
        )
        alert = cur.fetchone()

        cur.execute(
            'SELECT * FROM measurements WHERE patient_id = %s ORDER BY measured_at DESC LIMIT 5',
            (patient['user_id'],),
        )
        measurements = cur.fetchall()

        cur.execute(
            """SELECT max(given_at) AS given_at FROM consents
               WHERE user_id = %s AND kind = 'relative_sms' AND revoked_at IS NULL""",
            (patient['user_id'],),
        )
        consent = cur.fetchone()
        cur.execute('SELECT name FROM patient_contacts WHERE patient_id = %s', (patient['user_id'],))
        contact = cur.fetchone()
        audit(cur, 'relative_viewed', user['id'], f"patient:{patient['user_id']}", request.remote_addr)

    escalated = (alert and alert['accepted_at'] is None and alert['escalate_at'] is not None
                 and alert['escalate_at'] <= datetime.now(timezone.utc))
    return jsonify({
        'viewer': {'name': short_name(user['name'])},
        'patient': {
            'name': patient['name'],
            'relation': relation_of(contact['name']) if contact else None,
            'diagnosis': patient['diagnosis'],
            'phoneMasked': mask_phone(patient['phone']) if patient['phone'] else None,
            'phone': patient['phone'],
        },
        'alert': alert and {
            'value': fmt_value(alert),
            'unit': UNITS[alert['kind']],
            'kind': alert['kind'],
            'rule': alert['rule'],
            'createdAt': iso(alert['created_at']),
            'acceptedAt': iso(alert['accepted_at']),
            'acceptedBy': short_name(alert['accepted_by_name']) if alert['accepted_by_name'] else None,
            'escalateAt': iso(alert['escalate_at']),
            'relativeSmsAt': iso(alert['relative_sms_at']),
            'escalated': escalated,
        },
        'measurements': [{
            'id': row['id'],
            'value': fmt_value(row),
            'unit': UNITS[row['kind']],
            'level': evaluate(row, thresholds, patient['pef_best'])[0],
            'deviation': evaluate(row, thresholds, patient['pef_best'])[1],
            'measuredAt': iso(row['measured_at']),
        } for row in measurements],
        'notifications': {'push': patient['push_enabled'], 'sms': True},
        'consentAt': iso(consent['given_at']) if consent else None,
        'doctor': {'name': short_name(patient['doctor_name'])},
    })


@bp.post('/notifications')
@login_required('relative')
def notifications():
    push = bool((request.get_json(silent=True) or {}).get('push'))
    user = current_user()
    with db_cursor() as cur:
        patient = linked_patient(cur)
        if not patient:
            return error('Доступ к показателям не открыт. Обратитесь в клинику.', 404)
        cur.execute('UPDATE relative_links SET push_enabled = %s WHERE relative_id = %s', (push, user['id']))
        audit(cur, 'relative_notifications', user['id'], f"patient:{patient['user_id']}", request.remote_addr)
    return jsonify({'push': push})
