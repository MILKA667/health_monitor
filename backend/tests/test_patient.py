from helpers import login

from db import db_cursor


def test_home_requires_patient(client, demo):
    assert client.get('/api/patient/home').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/patient/home').status_code == 403


def test_home(client, demo):
    login(client, '+79000000102')
    home = client.get('/api/patient/home').get_json()

    assert home['name'] == 'Ковалёва Н. П.'
    assert home['kind'] == 'glucose' and home['kindTitle'] == 'Глюкоза крови'
    assert home['target'] == '4,4–10,0 ммоль/л'
    assert home['last']['value'] == '2,9' and home['last']['level'] == 'crit'
    assert home['last']['deviation'] == '−1,0 ниже 3,9'
    assert [row['value'] for row in home['recent']] == ['3,4', '3,8', '4,6']

    plan = home['plan']
    assert plan['total'] == 3 and plan['done'] == 3
    assert [item['time'] for item in plan['items']] == ['09:00', '10:30', '19:00']
    medication = plan['items'][0]
    assert medication['type'] == 'medication' and medication['title'] == 'Метформин 1000 мг'
    assert medication['subtitle'] == '1 таблетка после завтрака' and medication['done'] is True
    reminder = plan['items'][1]
    assert reminder['type'] == 'measurement' and reminder['title'] == 'Замер глюкозы натощак'
    assert reminder['subtitle'] == 'Данные передаст устройство'


def test_toggle_medication_intake(client, demo):
    login(client, '+79000000102')
    home = client.get('/api/patient/home').get_json()
    slot_id = home['plan']['items'][0]['slotId']

    assert client.post(f'/api/patient/plan/medications/{slot_id}', json={'done': False}).get_json() == {'done': False}
    assert client.get('/api/patient/home').get_json()['plan']['done'] == 2
    assert client.post(f'/api/patient/plan/medications/{slot_id}', json={'done': True}).get_json() == {'done': True}
    assert client.get('/api/patient/home').get_json()['plan']['done'] == 3

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'medication_intake'")
        assert cur.fetchone()['n'] == 2


def test_add_measurement_creates_critical_alert(client, demo):
    login(client, '+79000000102')
    response = client.post('/api/patient/measurements', json={
        'kind': 'glucose', 'value': '3,1', 'context': 'fast', 'wellbeing': ['weak', 'dizzy'],
    })
    assert response.status_code == 201
    payload = response.get_json()
    assert payload['measurement']['value'] == '3,1'
    assert payload['measurement']['level'] == 'crit'
    assert payload['alert']['level'] == 'crit'
    assert payload['alert']['rule'] == 'ниже критического порога 3,9'

    with db_cursor() as cur:
        cur.execute('SELECT context, wellbeing, source FROM measurements ORDER BY id DESC LIMIT 1')
        row = cur.fetchone()
        assert (row['context'], row['wellbeing'], row['source']) == ('fast', ['weak', 'dizzy'], 'manual')
        cur.execute("SELECT count(*) AS n FROM alerts WHERE level = 'crit' AND accepted_at IS NULL")
        assert cur.fetchone()['n'] == 3  # Ковалёва 2,9, Савельев 182/108 и новый 3,1


def test_add_measurement_within_target(client, demo):
    login(client, '+79000000102')
    response = client.post('/api/patient/measurements', json={'kind': 'glucose', 'value': '6,2', 'context': 'night'})
    assert response.status_code == 201
    assert response.get_json()['alert'] is None
    assert response.get_json()['measurement']['level'] == 'ok'


def test_measurement_validation(client, demo):
    login(client, '79000000103')  # Савельев, гипертония
    assert client.post('/api/patient/measurements', json={'kind': 'glucose', 'value': 'abn'}).status_code == 400
    assert client.post('/api/patient/measurements', json={'kind': 'glucose', 'value': '40'}).status_code == 400
    assert client.post('/api/patient/measurements', json={'kind': 'pef', 'value': '10'}).status_code == 400
    assert client.post('/api/patient/measurements', json={'kind': 'bp', 'value': '120'}).get_json()['error'] == \
        'Верхнее 60–260, нижнее 30–160 и меньше верхнего.'
    assert client.post('/api/patient/measurements', json={'kind': 'bp', 'value': '220', 'value2': '110'}).status_code == 201


def test_latest_alert_for_patient(client, demo):
    login(client, '+79000000102')
    alert = client.get('/api/patient/alerts/latest').get_json()

    assert alert['value'] == '2,9' and alert['unit'] == 'ммоль/л'
    assert alert['threshold'] == 'ниже 3,9 или выше 13,9 ммоль/л'
    assert alert['doctor'] == {'name': 'Смирнова Е. А.'}
    assert alert['relative'] == {'label': 'Сын, Ковалёв Д.'}
    assert alert['relativeSmsAt'] is not None
    assert alert['memo']['author'] == 'Смирнова Е. А.'
    assert alert['memo']['text'].startswith('Нина Петровна, примите 15–20 г')
    assert alert['escalated'] is False


def test_patient_cannot_touch_foreign_slot(client, demo):
    login(client, '+79000000103')
    assert client.post('/api/patient/plan/medications/1', json={'done': True}).status_code == 404


def test_history(client, demo):
    login(client, '+79000000102')
    data = client.get('/api/patient/measurements?days=14').get_json()

    assert data['days'] == 14 and data['kind'] == 'glucose'
    assert data['stats'][0] == {'label': 'Среднее', 'value': '3,7'}
    assert [measurement['value'] for measurement in data['measurements']] == ['2,9', '3,4', '3,8', '4,6']
    assert data['measurements'][0]['context'] == 'Натощак'
    assert data['chart']['series'][0]['id'] == 'glucose'
    assert data['chart']['bands'] == [{'from': 4.4, 'to': 10.0}]
    assert client.get('/api/patient/measurements?days=7').get_json()['days'] == 7
    assert client.get('/api/patient/measurements?days=30').status_code == 400


def test_history_requires_patient(client, demo):
    assert client.get('/api/patient/measurements').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/patient/measurements').status_code == 403
