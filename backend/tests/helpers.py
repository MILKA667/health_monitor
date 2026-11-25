import re

from werkzeug.security import generate_password_hash

from db import db_cursor


def login(client, login, password='demo1234'):
    response = client.post('/api/auth/login', json={'login': login, 'password': password})
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def create_doctor(client, phone='79000000901', name='Чужой Врач Петрович', email='other@demo.ru'):
    """Врач без пациентов — для проверки доступа к чужим данным."""
    with db_cursor() as cur:
        cur.execute(
            """INSERT INTO users (role, name, phone, email, password_hash)
               VALUES ('doctor', %s, %s, %s, %s) RETURNING id""",
            (name, phone, email, generate_password_hash('demo1234')),
        )
        doctor_id = cur.fetchone()['id']
        cur.execute("INSERT INTO doctors (user_id, specialty, clinic) VALUES (%s, 'терапевт', 'Клиника')",
                    (doctor_id,))
    login(client, phone)
    return doctor_id


def last_sms_code():
    with db_cursor() as cur:
        cur.execute('SELECT text FROM sms_outbox ORDER BY id DESC LIMIT 1')
        return re.search(r'\d{6}', cur.fetchone()['text']).group()
