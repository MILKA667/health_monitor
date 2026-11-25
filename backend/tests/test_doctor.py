from helpers import create_doctor, login

from db import db_cursor


def worklist(client):
    return {p['name']: p for p in client.get('/api/doctor/worklist').get_json()['patients']}


def test_doctor_api_requires_doctor(client, demo):
    assert client.get('/api/doctor/worklist').status_code == 401
    login(client, '+79000000102')
    assert client.get('/api/doctor/worklist').status_code == 403


def test_worklist_groups(client, demo):
    login(client, 'doctor@demo.ru')
    patients = worklist(client)
    levels = {name: p['level'] for name, p in patients.items()}
    assert levels == {
        'Ковалёва Нина Петровна': 'crit',
        'Савельев Игорь Андреевич': 'crit',
        'Мухина Дарья Олеговна': 'warn',
        'Петров Алексей Викторович': 'warn',
        'Лебедева Ольга Ивановна': 'warn',
        'Фёдоров Виктор Павлович': 'none',
        'Петрова Галина Ивановна': 'none',
        'Захаров Михаил Сергеевич': 'ok',
        'Орлова Ксения Дмитриевна': 'ok',
    }
    order = [p['level'] for p in client.get('/api/doctor/worklist').get_json()['patients']]
    assert order == sorted(order, key=['crit', 'warn', 'none', 'ok'].index)

    kovaleva = patients['Ковалёва Нина Петровна']
    assert kovaleva['last']['value'] == '2,9'
    assert kovaleva['last']['deviation'] == '−1,0 ниже 3,9'
    assert kovaleva['alert']['level'] == 'crit' and kovaleva['alert']['acceptedAt'] is None
    assert patients['Савельев Игорь Андреевич']['alert']['acceptedAt'] is None


def test_header_counts_open_critical_alerts(client, demo):
    login(client, 'doctor@demo.ru')
    assert client.get('/api/doctor/header').get_json() == {
        'name': 'Смирнова Е. А.', 'specialty': 'эндокринолог', 'openAlerts': 2}


def test_summary(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Мухина Дарья Олеговна']['id']
    summary = client.get(f'/api/doctor/patients/{patient_id}/summary').get_json()
    assert summary['target'] == 'ПСВ ≥ 80% (≥ 374 л/мин)'
    assert len(summary['measurements']) == 4
    assert summary['device'] is None and summary['relative'] is None


def test_summary_of_foreign_patient(client, demo):
    create_doctor(client)
    with db_cursor() as cur:
        cur.execute('SELECT user_id FROM patients LIMIT 1')
        patient_id = cur.fetchone()['user_id']
    assert client.get(f'/api/doctor/patients/{patient_id}/summary').status_code == 404


def test_accept_and_undo_alert(client, demo):
    login(client, 'doctor@demo.ru')
    alert_id = worklist(client)['Ковалёва Нина Петровна']['alert']['id']

    accepted = client.post(f'/api/doctor/alerts/{alert_id}/accept', json={'comment': 'Позвонила'}).get_json()
    assert accepted['acceptedBy'] == 'Смирнова Е. А.' and accepted['comment'] == 'Позвонила'
    assert client.post(f'/api/doctor/alerts/{alert_id}/accept', json={}).status_code == 409
    assert client.get('/api/doctor/header').get_json()['openAlerts'] == 1

    assert client.post(f'/api/doctor/alerts/{alert_id}/undo').get_json()['acceptedAt'] is None
    with db_cursor() as cur:
        cur.execute("SELECT action FROM audit_log WHERE action LIKE 'alert%' ORDER BY id")
        assert [row['action'] for row in cur.fetchall()] == ['alert_accepted', 'alert_accept_undone']


def test_foreign_doctor_cannot_accept_alerts(client, make_client, demo):
    login(client, 'doctor@demo.ru')
    alert_id = worklist(client)['Ковалёва Нина Петровна']['alert']['id']

    other = make_client()
    create_doctor(other)
    assert other.post(f'/api/doctor/alerts/{alert_id}/accept', json={}).status_code == 404
    assert client.post(f'/api/doctor/alerts/{alert_id}/accept', json={}).status_code == 200


def test_critical_alert_sends_sms_to_relative(demo):
    with db_cursor() as cur:
        cur.execute("SELECT text FROM sms_outbox WHERE phone = '79010000102' ORDER BY id DESC LIMIT 1")
        assert cur.fetchone()['text'].startswith('HealthMonitor: Ковалёва Н. П. — критичное значение 2,9 ммоль/л')


def test_no_data_alert_created_once(client, demo):
    login(client, 'doctor@demo.ru')
    worklist(client)
    worklist(client)
    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM alerts WHERE level = 'nodata'")
        # Фёдоров (3 дня без замеров) и Петрова (90 дней в наблюдении, замеров нет) — по одному алерту
        assert cur.fetchone()['n'] == 2


def test_record(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Ковалёва Нина Петровна']['id']
    record = client.get(f'/api/doctor/patients/{patient_id}/record?days=14').get_json()

    assert record['sex'] == 'жен.'
    assert record['diagnosis'] == 'Сахарный диабет 2 типа' and record['icdCode'] == 'E11.9'
    assert record['consentAt'] is not None
    assert record['stats'] == [
        {'label': 'Среднее', 'value': '3,7'},
        {'label': 'Мин.', 'value': '2,9', 'tone': 'crit'},
        {'label': 'Макс.', 'value': '4,6', 'tone': None},
        {'label': 'Вне цели', 'value': '3 из 4'},
    ]
    assert record['thresholds'][0]['value'] == 'ниже 3,9 или выше 13,9 ммоль/л'
    assert record['thresholds'][1]['value'] == '4,4–10,0 ммоль/л'
    assert record['lastMeasurementAt'] is not None

    chart = record['chart']
    assert chart['title'] == 'Глюкоза крови, ммоль/л'
    assert chart['bands'] == [{'from': 4.4, 'to': 10.0}]
    assert chart['guides'] == [{'value': 3.9, 'tone': 'crit', 'label': '3,9'}]
    latest = chart['series'][0]['points'][-1]
    assert (latest['value'], latest['level']) == (2.9, 'crit')
    assert [m['sourceLabel'] for m in record['measurements']] == ['глюкометр', 'глюкометр', 'глюкометр', 'вручную']

    with db_cursor() as cur:
        cur.execute("SELECT object FROM audit_log WHERE action = 'record_viewed'")
        assert cur.fetchone()['object'] == f'patient:{patient_id}'


def test_record_chart_of_two_lines_and_bad_period(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Савельев Игорь Андреевич']['id']
    record = client.get(f'/api/doctor/patients/{patient_id}/record?days=7').get_json()

    assert [series['id'] for series in record['chart']['series']] == ['sys', 'dia']
    assert record['chart']['bands'] == [{'from': 100.0, 'to': 140.0}]
    assert record['stats'][0]['value'] == '168/101'
    assert client.get(f'/api/doctor/patients/{patient_id}/record?days=5').status_code == 400


def test_record_of_foreign_patient_is_hidden(client, demo):
    create_doctor(client)
    with db_cursor() as cur:
        cur.execute('SELECT user_id FROM patients LIMIT 1')
        patient_id = cur.fetchone()['user_id']
    assert client.get(f'/api/doctor/patients/{patient_id}/record').status_code == 404
    assert client.get(f'/api/doctor/patients/{patient_id}/medications').status_code == 404
    assert client.get(f'/api/doctor/patients/{patient_id}/messages').status_code == 404


def test_medications_adherence(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Ковалёва Нина Петровна']['id']
    medications = client.get(f'/api/doctor/patients/{patient_id}/medications').get_json()

    assert medications['days'] == 14
    assert len(medications['medications']) == 1
    medication = medications['medications'][0]
    assert medication['name'] == 'Метформин 1000 мг'
    assert medication['schedule'] == '2 раза в день, после еды'
    assert (medication['taken'], medication['expected'], medication['percent']) == (26, 28, 93)
    assert medication['lastTakenAt'] is not None


def test_messages(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Ковалёва Нина Петровна']['id']

    history = client.get(f'/api/doctor/patients/{patient_id}/messages').get_json()['messages']
    assert [message['senderRole'] for message in history] == ['patient', 'doctor', 'patient']
    assert history[0]['author'] == 'Ковалёва Нина Петровна'

    sent = client.post(f'/api/doctor/patients/{patient_id}/messages',
                       json={'body': 'Повторите замер через 15 минут.'})
    assert sent.status_code == 201
    assert sent.get_json()['mine'] is True and sent.get_json()['author'] == 'Смирнова Елена Андреевна'

    assert client.post(f'/api/doctor/patients/{patient_id}/messages', json={'body': '   '}).status_code == 400
    assert len(client.get(f'/api/doctor/patients/{patient_id}/messages').get_json()['messages']) == 4

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'message_sent'")
        assert cur.fetchone()['n'] == 1


def test_patient_alert_log(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = worklist(client)['Ковалёва Нина Петровна']['id']
    alerts = client.get(f'/api/doctor/patients/{patient_id}/alerts').get_json()['alerts']

    assert len(alerts) == 3
    assert (alerts[0]['level'], alerts[0]['value'], alerts[0]['unit']) == ('crit', '2,9', 'ммоль/л')
    assert alerts[0]['acceptedAt'] is None
    assert alerts[0]['relativeSmsAt'] is not None
    assert alerts[1]['acceptedBy'] == 'Смирнова Е. А.'
    assert alerts[2]['level'] == 'crit'


def test_alerts_page(client, demo):
    login(client, 'doctor@demo.ru')
    payload = client.get('/api/doctor/alerts').get_json()

    assert payload['counts'] == {'open': 7, 'closed': 10, 'all': 17}

    kovaleva, saveliev = payload['alerts'][0], payload['alerts'][1]
    assert kovaleva['patientName'] == 'Ковалёва Нина Петровна'
    assert kovaleva['diagnosis'] == 'Сахарный диабет 2 типа'
    assert (kovaleva['value'], kovaleva['unit']) == ('2,9', 'ммоль/л')
    assert kovaleva['relativeName'] == 'Ковалёв Дмитрий, сын' and kovaleva['relativeSmsAt']
    assert kovaleva['acceptedAt'] is None and kovaleva['canAccept'] is True and kovaleva['own'] is True

    assert saveliev['patientName'] == 'Савельев Игорь Андреевич'
    assert saveliev['acceptedAt'] is None and saveliev['canAccept'] is True

    nodata = [a for a in payload['alerts'] if a['level'] == 'nodata']
    assert len(nodata) == 2 and all(a['value'] is None for a in nodata)


def test_alerts_accept_updates_counts(client, demo):
    login(client, 'doctor@demo.ru')
    alert = client.get('/api/doctor/alerts').get_json()['alerts'][0]

    assert client.post(f"/api/doctor/alerts/{alert['id']}/accept", json={}).status_code == 200
    counts = client.get('/api/doctor/alerts').get_json()['counts']
    assert counts == {'open': 6, 'closed': 11, 'all': 17}


def test_doctor_without_patients_sees_no_alerts(client, make_client, demo):
    other = make_client()
    create_doctor(other)
    payload = other.get('/api/doctor/alerts').get_json()

    assert payload['alerts'] == []
    assert payload['counts'] == {'open': 0, 'closed': 0, 'all': 0}
