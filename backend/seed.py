"""Демонстрационные данные для разработки: `flask --app app seed-demo`."""
import click
from werkzeug.security import generate_password_hash

from db import db_cursor

DEMO_PASSWORD = 'demo1234'
TEMP_PASSWORD = 'temp1234'

DOCTOR = {'name': 'Соколова Анна Викторовна', 'phone': '79000000001', 'email': 'doctor@demo.ru',
          'specialty': 'эндокринолог', 'clinic': 'Городская поликлиника № 3'}

# (ФИО, телефон, дата рождения, пол, нозология, диагноз, МКБ, полис, временный пароль)
PATIENTS = [
    ('Петрова Галина Ивановна', '79000000101', '1958-03-14', 'ж', 'diabetes',
     'Сахарный диабет 2 типа', 'E11.9', '7700 0000 0000 0101', True),
    ('Кузнецов Олег Сергеевич', '79000000102', '1966-11-02', 'м', 'hypertension',
     'Эссенциальная гипертензия', 'I10', '7700 0000 0000 0102', False),
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


@click.command('seed-demo')
def seed_demo():
    """Создаёт демо-врача, пациентов и администратора (повторный запуск безопасен)."""
    with db_cursor() as cur:
        upsert_user(cur, 'admin', 'Администратор клиники', '79000000000', 'admin@demo.ru', DEMO_PASSWORD)

        doctor_id = upsert_user(cur, 'doctor', DOCTOR['name'], DOCTOR['phone'], DOCTOR['email'], DEMO_PASSWORD)
        cur.execute(
            """INSERT INTO doctors (user_id, specialty, clinic) VALUES (%s, %s, %s)
               ON CONFLICT (user_id) DO NOTHING""",
            (doctor_id, DOCTOR['specialty'], DOCTOR['clinic']),
        )

        for name, phone, birth, sex, nosology, diagnosis, icd, policy, temporary in PATIENTS:
            patient_id = upsert_user(cur, 'patient', name, phone, None,
                                     TEMP_PASSWORD if temporary else DEMO_PASSWORD, temporary)
            cur.execute(
                """INSERT INTO patients (user_id, doctor_id, birth_date, sex, nosology, diagnosis, icd_code, policy)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id) DO NOTHING""",
                (patient_id, doctor_id, birth, sex, nosology, diagnosis, icd, policy),
            )

    click.echo(f'Готово. Пароль врача и администратора: {DEMO_PASSWORD}; '
               f'пациент +7 900 000-01-01 входит по временному паролю {TEMP_PASSWORD}.')
