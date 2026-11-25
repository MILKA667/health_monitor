"""Отчёты врача: параметры сохраняются, печатная версия собирается по запросу."""
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

from db import audit, db_cursor, today as app_today
from doctor import CONTEXT_LABEL, DEVICE_LABEL, stats_payload, thresholds_payload
from monitoring import UNITS, evaluate, fmt_number, fmt_value, load_thresholds
from security import current_user, error, login_required, short_name

bp = Blueprint('reports', __name__, url_prefix='/api/doctor/reports')

KINDS = {
    'patient': 'По пациенту',
    'group': 'По группе пациентов',
    'response': 'Реакция на алерты',
}
SECTIONS = {
    'dynamics': 'Динамика показателей',
    'alerts': 'Алерты и время реакции',
    'meds': 'Приверженность назначениям',
    'messages': 'Переписка с пациентом',
}
PERIODS = (14, 30, 90)
NOSOLOGIES = [('all', 'все нозологии'), ('diabetes', 'сахарный диабет'),
              ('hypertension', 'гипертония'), ('asthma', 'астма')]
NOSOLOGY_LABELS = dict(NOSOLOGIES)


def iso(value):
    return value.isoformat() if value else None


def age_of(birth_date):
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def response_minutes(row):
    if not row['accepted_at']:
        return None
    return max(0, round((row['accepted_at'] - row['created_at']).total_seconds() / 60))


def own_patients(cur, doctor_id):
    cur.execute(
        """SELECT p.user_id, p.diagnosis, u.name FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.doctor_id = %s ORDER BY u.name""",
        (doctor_id,),
    )
    return cur.fetchall()


def report_title(row):
    if row['kind'] == 'patient':
        return f"По пациенту · {short_name(row['patient_name'])}"
    if row['kind'] == 'group':
        return f"По группе пациентов · {NOSOLOGY_LABELS.get(row['nosology'], 'все нозологии')}"
    return 'Реакция на алерты · отделение'


def period_text(row):
    end = row['created_at'].date()
    start = end - timedelta(days=row['days'] - 1)
    return f"{start.strftime('%d.%m')}–{end.strftime('%d.%m.%Y')}"


def report_json(row):
    return {
        'id': row['id'],
        'kind': row['kind'],
        'title': report_title(row),
        'days': row['days'],
        'sections': [{'id': code, 'label': SECTIONS[code]} for code in row['sections'] if code in SECTIONS],
        'createdAt': iso(row['created_at']),
        'periodText': period_text(row),
    }


def load_report(cur, report_id):
    cur.execute(
        """SELECT r.*, u.name AS patient_name FROM reports r
           LEFT JOIN users u ON u.id = r.patient_id WHERE r.id = %s""",
        (report_id,),
    )
    return cur.fetchone()


@bp.get('')
@login_required('doctor')
def index():
    user = current_user()
    with db_cursor() as cur:
        cur.execute(
            """SELECT r.*, u.name AS patient_name FROM reports r
               LEFT JOIN users u ON u.id = r.patient_id
               WHERE r.doctor_id = %s ORDER BY r.created_at DESC LIMIT 50""",
            (user['id'],),
        )
        rows = cur.fetchall()
        patients = own_patients(cur, user['id'])
    return jsonify({
        'reports': [report_json(row) for row in rows],
        'options': {
            'kinds': [{'id': code, 'label': label} for code, label in KINDS.items()],
            'periods': list(PERIODS),
            'sections': [{'id': code, 'label': label} for code, label in SECTIONS.items()],
            'patients': [{'id': row['user_id'], 'label': short_name(row['name'])} for row in patients],
            'nosologies': [{'id': code, 'label': label} for code, label in NOSOLOGIES],
        },
    })


@bp.post('')
@login_required('doctor')
def create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    kind = data.get('kind')
    sections = data.get('sections') or []
    if kind not in KINDS:
        return error('Выберите тип отчёта.')
    try:
        days = int(data.get('days'))
    except (TypeError, ValueError):
        return error('Выберите период отчёта.')
    if days not in PERIODS:
        return error('Период: 14, 30 или 90 дней.')
    sections = [code for code in dict.fromkeys(sections) if code in SECTIONS]
    if not sections:
        return error('Выберите хотя бы один раздел.')

    patient_id = None
    nosology = None
    with db_cursor() as cur:
        if kind == 'patient':
            try:
                patient_id = int(data.get('patientId'))
            except (TypeError, ValueError):
                return error('Выберите пациента.')
            if not any(row['user_id'] == patient_id for row in own_patients(cur, user['id'])):
                return error('Пациент не найден.', 404)
        elif kind == 'group':
            nosology = data.get('nosology') or 'all'
            if nosology not in NOSOLOGY_LABELS:
                return error('Выберите нозологию.')

        cur.execute(
            """INSERT INTO reports (doctor_id, kind, patient_id, nosology, days, sections)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (user['id'], kind, patient_id, nosology, days, sections),
        )
        report_id = cur.fetchone()['id']
        audit(cur, 'report_created', user['id'], f'report:{report_id}', request.remote_addr)
        row = load_report(cur, report_id)
    return jsonify(report_json(row)), 201


def patient_dynamics(cur, patient, days):
    thresholds = load_thresholds(cur, patient)
    cur.execute(
        """SELECT * FROM measurements WHERE patient_id = %s
           AND measured_at > now() - make_interval(days => %s) ORDER BY measured_at DESC LIMIT 500""",
        (patient['user_id'], days),
    )
    rows = cur.fetchall()
    ordered = list(reversed(rows))
    kind = {'diabetes': 'glucose', 'hypertension': 'bp', 'asthma': 'pef'}[patient['nosology']]
    return {
        'stats': stats_payload(kind, ordered, thresholds, patient['pef_best']) if rows else [],
        'thresholds': thresholds_payload(patient, thresholds),
        'measurements': [{
            'measuredAt': iso(row['measured_at']),
            'value': fmt_value(row),
            'unit': UNITS[row['kind']],
            'level': evaluate(row, thresholds, patient['pef_best'])[0],
            'context': CONTEXT_LABEL.get(row['context'], ''),
            'source': DEVICE_LABEL[row['kind']] if row['source'] == 'device' else 'вручную',
        } for row in rows],
    }


def patient_alerts(cur, patient_id, days):
    cur.execute(
        """SELECT a.*, u.name AS accepted_by_name,
                  COALESCE(a.accepted_at IS NULL AND a.escalate_at <= now(), FALSE) AS escalated,
                  m.value, m.value2, m.kind
           FROM alerts a
           LEFT JOIN users u ON u.id = a.accepted_by
           LEFT JOIN measurements m ON m.id = a.measurement_id
           WHERE a.patient_id = %s AND a.created_at > now() - make_interval(days => %s)
           ORDER BY a.created_at DESC LIMIT 500""",
        (patient_id, days),
    )
    return [{
        'createdAt': iso(row['created_at']),
        'level': row['level'],
        'value': fmt_value(row) if row['kind'] else None,
        'unit': UNITS[row['kind']] if row['kind'] else None,
        'rule': row['rule'],
        'acceptedBy': short_name(row['accepted_by_name']) if row['accepted_by_name'] else None,
        'responseMinutes': response_minutes(row),
        'escalated': row['escalated'],
    } for row in cur.fetchall()]


def patient_meds(cur, patient_id, days):
    start = app_today() - timedelta(days=days - 1)
    cur.execute('SELECT * FROM medications WHERE patient_id = %s ORDER BY prescribed_at, id', (patient_id,))
    result = []
    for medication in cur.fetchall():
        cur.execute('SELECT count(*) AS n FROM medication_slots WHERE medication_id = %s', (medication['id'],))
        slots = cur.fetchone()['n']
        cur.execute(
            """SELECT count(*) AS taken FROM medication_intakes mi
               JOIN medication_slots ms ON ms.id = mi.slot_id
               WHERE ms.medication_id = %s AND mi.taken_on >= %s""",
            (medication['id'], start),
        )
        taken = cur.fetchone()['taken']
        window_start = max(start, medication['prescribed_at'])
        expected = ((app_today() - window_start).days + 1) * slots if window_start <= app_today() else 0
        result.append({
            'name': medication['name'],
            'schedule': medication['schedule'],
            'taken': taken,
            'expected': expected,
            'percent': round(taken * 100 / expected) if expected else None,
        })
    return result


def patient_messages(cur, patient_id, days):
    cur.execute(
        """SELECT m.body, m.created_at, u.name AS author
           FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.patient_id = %s AND m.created_at > now() - make_interval(days => %s)
           ORDER BY m.created_at LIMIT 500""",
        (patient_id, days),
    )
    return [{'createdAt': iso(row['created_at']), 'author': row['author'], 'body': row['body']}
            for row in cur.fetchall()]


def group_report(cur, doctor_id, nosology, days):
    query = """SELECT p.user_id, p.nosology, p.pef_best, p.diagnosis, u.name FROM patients p
               JOIN users u ON u.id = p.user_id WHERE p.doctor_id = %s"""
    params = [doctor_id]
    if nosology != 'all':
        query += ' AND p.nosology = %s'
        params.append(nosology)
    cur.execute(query + ' ORDER BY u.name', params)

    rows = []
    total_measurements = total_alerts = 0
    responses = []
    for patient in cur.fetchall():
        thresholds = load_thresholds(cur, patient)
        cur.execute(
            """SELECT * FROM measurements WHERE patient_id = %s
               AND measured_at > now() - make_interval(days => %s)""",
            (patient['user_id'], days),
        )
        measurements = cur.fetchall()
        levels = [evaluate(row, thresholds, patient['pef_best'])[0] for row in measurements]
        out = sum(1 for level in levels if level != 'ok')

        cur.execute(
            """SELECT count(*) AS n, avg(extract(epoch FROM a.accepted_at - a.created_at)) / 60 AS avg_response
               FROM alerts a WHERE a.patient_id = %s AND a.created_at > now() - make_interval(days => %s)""",
            (patient['user_id'], days),
        )
        alerts = cur.fetchone()
        total_measurements += len(measurements)
        total_alerts += alerts['n']
        if alerts['avg_response'] is not None:
            responses.append(float(alerts['avg_response']))
        rows.append({
            'name': patient['name'],
            'diagnosis': patient['diagnosis'],
            'measurements': len(measurements),
            'outOfTarget': out,
            'outPercent': round(out * 100 / len(measurements)) if measurements else None,
            'alerts': alerts['n'],
            'avgResponseMinutes': round(float(alerts['avg_response'])) if alerts['avg_response'] is not None else None,
        })

    return {
        'nosology': nosology,
        'label': NOSOLOGY_LABELS[nosology],
        'rows': rows,
        'totals': {
            'patients': len(rows),
            'measurements': total_measurements,
            'alerts': total_alerts,
            'avgResponseMinutes': round(sum(responses) / len(responses)) if responses else None,
        },
    }


def response_report(cur, doctor_id, days):
    cur.execute(
        """SELECT a.*, u.name AS patient_name, acc.name AS accepted_by_name,
                  COALESCE(a.accepted_at IS NULL AND a.escalate_at <= now(), FALSE) AS escalated,
                  m.value, m.value2, m.kind
           FROM alerts a
           JOIN patients p ON p.user_id = a.patient_id
           JOIN users u ON u.id = a.patient_id
           LEFT JOIN users acc ON acc.id = a.accepted_by
           LEFT JOIN measurements m ON m.id = a.measurement_id
           WHERE p.doctor_id = %s AND a.created_at > now() - make_interval(days => %s)
           ORDER BY a.created_at DESC LIMIT 500""",
        (doctor_id, days),
    )
    rows = cur.fetchall()
    responses = [response_minutes(row) for row in rows if row['accepted_at']]
    return {
        'rows': [{
            'createdAt': iso(row['created_at']),
            'patientName': row['patient_name'],
            'level': row['level'],
            'value': fmt_value(row) if row['kind'] else None,
            'unit': UNITS[row['kind']] if row['kind'] else None,
            'rule': row['rule'],
            'acceptedBy': short_name(row['accepted_by_name']) if row['accepted_by_name'] else None,
            'responseMinutes': response_minutes(row),
            'escalated': row['escalated'],
        } for row in rows],
        'summary': {
            'total': len(rows),
            'crit': sum(1 for row in rows if row['level'] == 'crit'),
            'escalated': sum(1 for row in rows if row['escalated']),
            'accepted': len(responses),
            'avgResponseMinutes': round(sum(responses) / len(responses)) if responses else None,
        },
    }


@bp.get('/<int:report_id>')
@login_required('doctor')
def detail(report_id):
    user = current_user()
    with db_cursor() as cur:
        report = load_report(cur, report_id)
        if not report or report['doctor_id'] != user['id']:
            return error('Отчёт не найден.', 404)
        cur.execute('SELECT specialty, clinic FROM doctors WHERE user_id = %s', (user['id'],))
        doctor = cur.fetchone() or {'specialty': None, 'clinic': None}

        payload = {
            **report_json(report),
            'doctor': {'name': short_name(user['name']), 'specialty': doctor['specialty'], 'clinic': doctor['clinic']},
        }
        sections = report['sections']

        if report['kind'] == 'patient':
            cur.execute(
                """SELECT p.*, u.name FROM patients p JOIN users u ON u.id = p.user_id WHERE p.user_id = %s""",
                (report['patient_id'],),
            )
            patient = cur.fetchone()
            payload['patient'] = {
                'name': patient['name'],
                'sex': {'м': 'муж.', 'ж': 'жен.'}.get(patient['sex']),
                'age': age_of(patient['birth_date']),
                'diagnosis': patient['diagnosis'],
                'icdCode': patient['icd_code'],
                'policyTail': patient['policy'][-4:] if patient['policy'] else None,
            }
            if 'dynamics' in sections:
                payload['patient']['dynamics'] = patient_dynamics(cur, patient, report['days'])
            if 'alerts' in sections:
                payload['patient']['alerts'] = patient_alerts(cur, patient['user_id'], report['days'])
            if 'meds' in sections:
                payload['patient']['meds'] = patient_meds(cur, patient['user_id'], report['days'])
            if 'messages' in sections:
                payload['patient']['messages'] = patient_messages(cur, patient['user_id'], report['days'])
        elif report['kind'] == 'group':
            payload['group'] = group_report(cur, user['id'], report['nosology'], report['days'])
        else:
            payload['response'] = response_report(cur, user['id'], report['days'])

        audit(cur, 'report_viewed', user['id'], f'report:{report_id}', request.remote_addr)
    return jsonify(payload)
