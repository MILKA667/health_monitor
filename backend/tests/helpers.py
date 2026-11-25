import re

from werkzeug.security import generate_password_hash

from db import db_cursor
from notifications import SENT


def login(client, login, password='demo1234'):
    response = client.post('/api/auth/login', json={'login': login, 'password': password})
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def link_telegram(phone=None, user_id=None, chat_id=900001):
    """Привязывает Telegram-чат к пользователю (по телефону или id)."""
    with db_cursor() as cur:
        if user_id is not None:
            cur.execute('UPDATE users SET telegram_chat_id = %s WHERE id = %s', (chat_id, user_id))
        else:
            cur.execute('UPDATE users SET telegram_chat_id = %s WHERE phone = %s', (chat_id, phone))
    return chat_id


def last_notification_text():
    assert SENT, 'уведомлений не было'
    return SENT[-1]['text']


def last_code():
    for item in reversed(SENT):
        match = re.search(r'\b(\d{6})\b', item['text'])
        if match:
            return match.group(1)
    raise AssertionError('в уведомлениях нет шестизначного кода')


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