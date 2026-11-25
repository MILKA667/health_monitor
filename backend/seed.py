"""Демонстрационные данные для разработки: `flask --app app seed-demo`."""
from datetime import date, datetime, timedelta, timezone

import click
from flask.cli import with_appcontext
from werkzeug.security import generate_password_hash

from db import db_cursor
from monitoring import record_measurement

DEMO_PASSWORD = 'demo1234'
TEMP_PASSWORD = 'temp1234'

DOCTORS = [
    # ФИО, телефон, e-mail, специальность, дежурный
    ('Смирнова Елена Андреевна', '79000000001', 'doctor@demo.ru', 'эндокринолог', False),
    ('Орлов Виктор Николаевич', '79000000002', 'duty@demo.ru', 'терапевт', True),
]
CLINIC = 'Городская поликлиника № 3'

DEVICE_MODELS = {'glucometer': '[модель глюкометра]', 'tonometer': '[модель тонометра]'}

# Измерения: (сколько минут назад, значение, второе значение, источник)
PATIENTS = [
    {'name': 'Ковалёва Нина Петровна', 'phone': '79000000102', 'age': 67, 'sex': 'ж', 'nosology': 'diabetes',
     'diagnosis': 'Сахарный диабет 2 типа', 'icd': 'E11.9', 'policy': '7700000000004821', 'device': 'glucometer',
     'contact': ('Ковалёв Дмитрий, сын', '79010000102'),
     'measurements': [(4, 2.9, None, 'device'), (13 * 60 + 37, 3.4, None, 'device'),
                      (26 * 60 + 30, 3.8, None, 'device'), (50 * 60 + 12, 4.6, None, 'manual')]},
    {'name': 'Савельев Игорь Андреевич', 'phone': '79000000103', 'age': 58, 'sex': 'м', 'nosology': 'hypertension',
     'diagnosis': 'Эссенциальная гипертензия', 'icd': 'I10', 'policy': '7700000000001907', 'device': 'tonometer',
     'contact': ('Савельева Марина, жена', '79010000103'),
     'measurements': [(22, 182, 108, 'device'), (14 * 60 + 2, 171, 102, 'device'),
                      (26 * 60 + 37, 158, 96, 'device'), (38 * 60 + 32, 160, 98, 'device')]},
    {'name': 'Мухина Дарья Олеговна', 'phone': '79000000104', 'age': 34, 'sex': 'ж', 'nosology': 'asthma',
     'diagnosis': 'Бронхиальная астма', 'icd': 'J45.0', 'policy': '7700000000003375', 'pef_best': 468,
     'measurements': [(61, 290, None, 'manual'), (25 * 60 + 12, 320, None, 'manual'),
                      (49 * 60 + 27, 350, None, 'manual'), (73 * 60 + 22, 380, None, 'manual')]},
    {'name': 'Петров Алексей Викторович', 'phone': '79000000105', 'age': 71, 'sex': 'м', 'nosology': 'hypertension',
     'diagnosis': 'Эссенциальная гипертензия', 'icd': 'I10', 'policy': '7700000000000482', 'device': 'tonometer',
     'contact': ('Петрова Людмила, дочь', '79010000105'),
     'measurements': [(167, 152, 94, 'device'), (15 * 60 + 12, 148, 92, 'device'),
                      (26 * 60 + 52, 146, 90, 'device'), (39 * 60 + 22, 138, 86, 'device')]},
    {'name': 'Лебедева Ольга Ивановна', 'phone': '79000000106', 'age': 49, 'sex': 'ж', 'nosology': 'diabetes',
     'diagnosis': 'Сахарный диабет 1 типа', 'icd': 'E10.9', 'policy': '7700000000007710',
     'measurements': [(312, 11.4, None, 'manual'), (12 * 60 + 42, 9.8, None, 'manual'),
                      (21 * 60 + 32, 10.2, None, 'manual'), (27 * 60 + 2, 8.4, None, 'manual')]},
    {'name': 'Фёдоров Виктор Павлович', 'phone': '79000000107', 'age': 75, 'sex': 'м', 'nosology': 'diabetes',
     'diagnosis': 'Сахарный диабет 2 типа', 'icd': 'E11.9', 'policy': '7700000000002288', 'device': 'glucometer',
     'contact': ('Фёдорова Нина, жена', '79010000107'),
     'measurements': [(3 * 1440 + 152, 6.8, None, 'device'), (4 * 1440 + 157, 7.0, None, 'device'),
                      (5 * 1440 + 142, 6.6, None, 'device')]},
    {'name': 'Захаров Михаил Сергеевич', 'phone': '79000000108', 'age': 63, 'sex': 'м', 'nosology': 'hypertension',
     'diagnosis': 'Эссенциальная гипертензия', 'icd': 'I10', 'policy': '7700000000005126', 'device': 'tonometer',
     'measurements': [(14 * 60 + 28, 128, 82, 'device'), (26 * 60 + 42, 131, 84, 'device'),
                      (38 * 60 + 37, 127, 80, 'device')]},
    {'name': 'Орлова Ксения Дмитриевна', 'phone': '79000000109', 'age': 29, 'sex': 'ж', 'nosology': 'asthma',
     'diagnosis': 'Бронхиальная астма', 'icd': 'J45.0', 'policy': '7700000000006043', 'pef_best': 475,
     'measurements': [(25 * 60 + 2, 430, None, 'manual'), (49 * 60 + 7, 427, None, 'manual'),
                      (73 * 60 + 12, 432, None, 'manual')]},
    # Учётку создала клиника, пациентка ещё не входила
    {'name': 'Петрова Галина Ивановна', 'phone': '79000000101', 'age': 68, 'sex': 'ж', 'nosology': 'diabetes',
     'diagnosis': 'Сахарный диабет 2 типа', 'icd': 'E11.9', 'policy': '7700000000000101', 'temporary': True,
     'measurements': []},
]


def upsert_user(cur, role, name, phone, email, password, temporary=False):
    cur.execute(
        """INSERT INTO users (role, name, phone, email, password_hash, must_change_password)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
           RETURNING id""",
        (role, name, phone, email, generate_password_hash(password), temporary),
    )
    return cur.fetchone()['id']


def birth_date(years):
    today = date.today()
    return today.replace(year=today.year - years) - timedelta(days=40)


def seed_patient(cur, doctor_id, data, now):
    patient_id = upsert_user(cur, 'patient', data['name'], data['phone'], None,
                             TEMP_PASSWORD if data.get('temporary') else DEMO_PASSWORD, data.get('temporary', False))
    cur.execute(
        """INSERT INTO patients (user_id, doctor_id, birth_date, sex, nosology, diagnosis, icd_code, policy,
                                 enrolled_at, pef_best)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (user_id) DO NOTHING""",
        (patient_id, doctor_id, birth_date(data['age']), data['sex'], data['nosology'], data['diagnosis'],
         data['icd'], data['policy'], date.today() - timedelta(days=90), data.get('pef_best')),
    )
    cur.execute('SELECT * FROM patients WHERE user_id = %s', (patient_id,))
    patient = cur.fetchone()

    cur.execute('SELECT 1 FROM measurements WHERE patient_id = %s LIMIT 1', (patient_id,))
    if cur.fetchone():
        return  # измерения уже есть — повторный запуск ничего не дублирует

    if data.get('contact'):
        cur.execute(
            'INSERT INTO patient_contacts (patient_id, name, phone) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING',
            (patient_id, *data['contact']),
        )

    device_id = None
    if data.get('device'):
        last_sync = now - timedelta(minutes=data['measurements'][0][0])
        cur.execute(
            'INSERT INTO devices (patient_id, kind, model, last_sync) VALUES (%s, %s, %s, %s) RETURNING id',
            (patient_id, data['device'], DEVICE_MODELS[data['device']], last_sync),
        )
        device_id = cur.fetchone()['id']

    kind = {'diabetes': 'glucose', 'hypertension': 'bp', 'asthma': 'pef'}[data['nosology']]
    alerts = []
    for minutes_ago, value, value2, source in reversed(data['measurements']):
        _, alert = record_measurement(cur, patient, kind, value, value2, source,
                                      device_id if source == 'device' else None,
                                      measured_at=now - timedelta(minutes=minutes_ago))
        if alert:
            alerts.append(alert)

    # Старые алерты врач уже разобрал; открытым остаётся только самый свежий
    for alert in alerts[:-1]:
        cur.execute(
            'UPDATE alerts SET accepted_at = created_at + interval %s, accepted_by = %s WHERE id = %s',
            ('6 minutes' if alert['level'] == 'crit' else '22 minutes', doctor_id, alert['id']),
        )


@click.command('seed-demo')
@with_appcontext
def seed_demo():
    """Создаёт демо-врачей, пациентов с измерениями и администратора (повторный запуск безопасен)."""
    now = datetime.now(timezone.utc)
    with db_cursor() as cur:
        upsert_user(cur, 'admin', 'Администратор клиники', '79000000000', 'admin@demo.ru', DEMO_PASSWORD)

        doctor_ids = []
        for name, phone, email, specialty, on_duty in DOCTORS:
            doctor_id = upsert_user(cur, 'doctor', name, phone, email, DEMO_PASSWORD)
            cur.execute(
                """INSERT INTO doctors (user_id, specialty, clinic, on_duty) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (user_id) DO NOTHING""",
                (doctor_id, specialty, CLINIC, on_duty),
            )
            doctor_ids.append(doctor_id)

        for data in PATIENTS:
            seed_patient(cur, doctor_ids[0], data, now)

    click.echo(f'Готово. Пароль врачей, администратора и пациентов: {DEMO_PASSWORD}; '
               f'пациентка +7 900 000-01-01 входит по временному паролю {TEMP_PASSWORD}.')
