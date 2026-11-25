from helpers import login
from werkzeug.security import generate_password_hash

from db import db_cursor


def test_relative_home(client, demo):
    login(client, 'relative@demo.ru')
    data = client.get('/api/relative/home').get_json()

    assert data['viewer'] == {'name': 'Ковалёв Д. С.'}
    assert data['patient'] == {
        'name': 'Ковалёва Нина Петровна',
        'relation': 'сын',
        'diagnosis': 'Сахарный диабет 2 типа',
        'phoneMasked': '+7 ••• ••• 01 02',
        'phone': '79000000102',
    }
    assert data['alert']['value'] == '2,9' and data['alert']['kind'] == 'glucose'
    assert data['alert']['relativeSmsAt'] is not None
    assert data['alert']['acceptedAt'] is None
    assert [row['value'] for row in data['measurements']] == ['2,9', '3,4', '3,8', '4,6']
    assert data['measurements'][0]['level'] == 'crit'
    assert data['notifications'] == {'push': True, 'sms': True}
    assert data['consentAt'] is not None
    assert data['doctor'] == {'name': 'Смирнова Е. А.'}

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'relative_viewed'")
        assert cur.fetchone()['n'] == 1


def test_relative_push_toggle(client, demo):
    login(client, 'relative@demo.ru')
    assert client.post('/api/relative/notifications', json={'push': False}).get_json() == {'push': False}
    home = client.get('/api/relative/home').get_json()
    assert home['notifications']['push'] is False

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'relative_notifications'")
        assert cur.fetchone()['n'] == 1


def test_relative_has_no_other_access(client, demo):
    assert client.get('/api/relative/home').status_code == 401
    login(client, '+79000000102')
    assert client.get('/api/relative/home').status_code == 403

    login(client, 'relative@demo.ru')
    assert client.get('/api/patient/home').status_code == 403
    assert client.get('/api/patient/chat').status_code == 403
    assert client.get('/api/doctor/worklist').status_code == 403


def test_relative_without_link(client, demo):
    with db_cursor() as cur:
        cur.execute(
            """INSERT INTO users (role, name, phone, password_hash)
               VALUES ('relative', 'Без Связи Р. Р.', '79000000999', %s) RETURNING id""",
            (generate_password_hash('demo1234'),),
        )
    login(client, '79000000999')
    assert client.get('/api/relative/home').status_code == 404
