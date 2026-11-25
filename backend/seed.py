"""Демонстрационные данные для разработки: `flask --app app seed-demo`."""
from datetime import datetime, timedelta

import click
from flask.cli import with_appcontext
from werkzeug.security import generate_password_hash

from db import APP_TIMEZONE, db_cursor, today as app_today
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

# Назначения по нозологии: (название, схема, [(время, что принять)])
MEDICATIONS = {
    'diabetes': [('Метформин 1000 мг', '2 раза в день, после еды',
                  [('09:00', '1 таблетка после завтрака'), ('19:00', '1 таблетка после ужина')])],
    'hypertension': [('Лизиноприл 10 мг', '1 раз в день, утром', [('08:00', '1 таблетка утром')])],
    'asthma': [('Будесонид 200 мкг', '2 раза в день, ингаляции',
                [('08:00', '1 ингаляция утром'), ('21:00', '1 ингаляция вечером')])],
}
ADHERENCE_DAYS = 14

# Переписка врача с пациенткой из первого примера: (телефон, кто пишет, минут назад, текст)
MESSAGES = [
    ('79000000102', 'patient', 65, 'Голова кружится, руки дрожат. Глюкометр показал 2,9.'),
    ('79000000102', 'doctor', 63, 'Нина Петровна, примите 15–20 г быстрых углеводов: '
                                  'стакан сока или 4 таблетки глюкозы. Через 15 минут повторите замер.'),
    ('79000000102', 'patient', 61, 'Выпила сок. Жду.'),
]

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
    today = app_today()
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
         data['icd'], data['policy'], app_today() - timedelta(days=90), data.get('pef_best')),
    )
    cur.execute('SELECT * FROM patients WHERE user_id = %s', (patient_id,))
    patient = cur.fetchone()

    cur.execute('SELECT 1 FROM consents WHERE user_id = %s LIMIT 1', (patient_id,))
    if not cur.fetchone() and not data.get('temporary'):
        # Учётки, созданные клиникой, согласия ещё не давали — их пациент подписывает при первом входе
        consents = [(patient_id, 'personal_data', patient['enrolled_at']),
                    (patient_id, 'no_diagnosis', patient['enrolled_at'])]
        if data.get('contact'):
            consents.append((patient_id, 'relative_sms', patient['enrolled_at']))
        cur.executemany(
            'INSERT INTO consents (user_id, kind, given_at) VALUES (%s, %s, %s)',
            consents,
        )
    cur.execute('SELECT 1 FROM measurements WHERE patient_id = %s LIMIT 1', (patient_id,))
    if cur.fetchone():
        return patient_id  # измерения уже есть — повторный запуск ничего не дублирует

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
    # Контекст замера: натощак → перед сном → через 2 часа после еды
    contexts = data.get('contexts', ['fast', 'night', 'after', 'fast'])
    alerts = []
    for index, (minutes_ago, value, value2, source) in enumerate(reversed(data['measurements'])):
        _, alert = record_measurement(cur, patient, kind, value, value2, source,
                                      device_id if source == 'device' else None,
                                      context=contexts[index % len(contexts)],
                                      measured_at=now - timedelta(minutes=minutes_ago))
        if alert:
            alerts.append(alert)

    # Старые алерты врач уже разобрал; открытым остаётся только самый свежий
    for alert in alerts[:-1]:
        cur.execute(
            'UPDATE alerts SET accepted_at = created_at + interval %s, accepted_by = %s WHERE id = %s',
            ('6 minutes' if alert['level'] == 'crit' else '22 minutes', doctor_id, alert['id']),
        )
    return patient_id


def seed_medications(cur, patient_id, nosology, now):
    """Назначения и отметки о приёме за последние 14 дней (26 из 28 — с двумя пропусками)."""
    cur.execute('SELECT 1 FROM medications WHERE patient_id = %s LIMIT 1', (patient_id,))
    if cur.fetchone():
        return
    for name, schedule, slots in MEDICATIONS[nosology]:
        cur.execute(
            """INSERT INTO medications (patient_id, name, schedule, prescribed_at)
               VALUES (%s, %s, %s, %s) RETURNING id""",
            (patient_id, name, schedule, (now - timedelta(days=40)).date()),
        )
        medication_id = cur.fetchone()['id']
        for slot_number, (time_text, dose) in enumerate(slots, start=1):
            cur.execute(
                """INSERT INTO medication_slots (medication_id, time_of_day, dose)
                   VALUES (%s, %s, %s) RETURNING id""",
                (medication_id, time_text, dose),
            )
            slot_id = cur.fetchone()['id']
            for day_offset in range(ADHERENCE_DAYS):
                if (day_offset + slot_number) % 13 == 0:
                    continue  # пропущенный приём
                taken_at = now - timedelta(days=day_offset, minutes=20 * (slot_number - 1))
                cur.execute(
                    'INSERT INTO medication_intakes (slot_id, taken_on, taken_at) VALUES (%s, %s, %s)',
                    (slot_id, taken_at.date(), taken_at),
                )


def seed_messages(cur, patient_id, doctor_id, now):
    """Переписка из демонстрационного сценария: пациентка жалуется, врач отвечает."""
    cur.execute('SELECT 1 FROM messages WHERE patient_id = %s LIMIT 1', (patient_id,))
    if cur.fetchone():
        return
    cur.execute('SELECT phone FROM users WHERE id = %s', (patient_id,))
    phone = cur.fetchone()['phone']
    sent = [(patient_phone, author, minutes_ago, text) for patient_phone, author, minutes_ago, text in MESSAGES
            if patient_phone == phone]
    for index, (_, author, minutes_ago, text) in enumerate(sent):
        # Последнее сообщение пациента врач ещё не читал — в списке диалогов будет «1 нов.»
        unread = author == 'patient' and index == len(sent) - 1
        cur.execute(
            'INSERT INTO messages (patient_id, sender_id, body, created_at, read_at) VALUES (%s, %s, %s, %s, %s)',
            (patient_id, patient_id if author == 'patient' else doctor_id, text,
             now - timedelta(minutes=minutes_ago), None if unread else now),
        )


def seed_reminders(cur, patient_id, nosology):
    """Одно напоминание о замере на пациента, чтобы «План на сегодня» не был пустым."""
    cur.execute('SELECT 1 FROM measurement_reminders WHERE patient_id = %s LIMIT 1', (patient_id,))
    if cur.fetchone():
        return
    kind, time_text = {
        'diabetes': ('glucose', '10:30'),
        'hypertension': ('bp', '08:00'),
        'asthma': ('pef', '07:30'),
    }[nosology]
    cur.execute(
        'INSERT INTO measurement_reminders (patient_id, kind, time_of_day) VALUES (%s, %s, %s)',
        (patient_id, kind, time_text),
    )


@click.command('seed-demo')
@with_appcontext
def seed_demo():
    """Создаёт демо-врачей, пациентов с измерениями и администратора (повторный запуск безопасен)."""
    now = datetime.now(APP_TIMEZONE)
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

        patient_ids = {}
        for data in PATIENTS:
            patient_id = seed_patient(cur, doctor_ids[0], data, now)
            seed_medications(cur, patient_id, data['nosology'], now)
            seed_reminders(cur, patient_id, data['nosology'])
            seed_messages(cur, patient_id, doctor_ids[0], now)
            patient_ids[data['phone']] = patient_id

        relative_id = upsert_user(cur, 'relative', 'Ковалёв Дмитрий Сергеевич', '79010000102',
                                  'relative@demo.ru', DEMO_PASSWORD)
        cur.execute(
            'INSERT INTO relative_links (relative_id, patient_id) VALUES (%s, %s) ON CONFLICT (relative_id) DO NOTHING',
            (relative_id, patient_ids['79000000102']),
        )

        # Заявки для админки: одна на каждую роль, все ещё на рассмотрении
        cur.execute('SELECT 1 FROM applications LIMIT 1')
        if not cur.fetchone():
            cur.executemany(
                """INSERT INTO applications (role, name, phone, email, extra, consent_personal_data, consent_no_diagnosis)
                   VALUES (%s, %s, %s, %s, %s, TRUE, TRUE)""",
                [
                    ('doctor', 'Гусев Роман Ильич', '79000000501', 'r.gusev@clinic.ru',
                     'пульмонолог, Городская поликлиника № 3'),
                    ('relative', 'Савельева Марина Викторовна', '79010000103', None, 'Савельев Игорь Андреевич'),
                    ('patient', 'Тихонов Глеб Аркадьевич', '79000000777', 'g.tikhonov@mail.ru', ''),
                ],
            )

    click.echo(f'Готово. Пароль врачей, администратора и пациентов: {DEMO_PASSWORD}; '
               f'пациентка +7 900 000-01-01 входит по временному паролю {TEMP_PASSWORD}.')
