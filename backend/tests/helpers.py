import re

from db import db_cursor


def login(client, login, password='demo1234'):
    response = client.post('/api/auth/login', json={'login': login, 'password': password})
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def last_sms_code():
    with db_cursor() as cur:
        cur.execute('SELECT text FROM sms_outbox ORDER BY id DESC LIMIT 1')
        return re.search(r'\d{6}', cur.fetchone()['text']).group()
