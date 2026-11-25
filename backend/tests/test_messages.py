from helpers import create_doctor, login

from db import db_cursor


def conversations(client):
    response = client.get('/api/doctor/messages')
    assert response.status_code == 200, response.get_json()
    return response.get_json()['conversations']


def test_dialogs_list(client, demo):
    login(client, 'doctor@demo.ru')
    items = conversations(client)

    assert len(items) == 1
    kovaleva = items[0]
    assert kovaleva['name'] == 'Ковалёва Нина Петровна'
    assert kovaleva['shortName'] == 'Ковалёва Н. П.'
    assert kovaleva['diagnosis'] == 'Сахарный диабет 2 типа'
    assert kovaleva['unread'] == 1
    assert kovaleva['lastMessage']['body'] == 'Выпила сок. Жду.'
    assert kovaleva['lastMessage']['mine'] is False
    assert kovaleva['lastMeasurement']['value'] == '2,9'
    assert kovaleva['lastMeasurement']['unit'] == 'ммоль/л'
    assert kovaleva['lastMeasurement']['level'] == 'crit'
    assert kovaleva['alert']['value'] == '2,9' and kovaleva['alert']['relativeSmsAt']
    assert kovaleva['alert']['relativeSmsAt'] is not None

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'messages_viewed'")
        assert cur.fetchone()['n'] == 1


def kovalova_id(client):
    patients = client.get('/api/doctor/worklist').get_json()['patients']
    return next(patient['id'] for patient in patients if patient['name'] == 'Ковалёва Нина Петровна')


def test_opening_dialog_marks_read(client, demo):
    login(client, 'doctor@demo.ru')
    assert conversations(client)[0]['unread'] == 1

    client.get(f'/api/doctor/patients/{kovalova_id(client)}/messages')
    assert conversations(client)[0]['unread'] == 0


def test_patient_reply_moves_dialog_and_counts_unread(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = kovalova_id(client)
    with db_cursor() as cur:
        cur.execute('INSERT INTO messages (patient_id, sender_id, body) VALUES (%s, %s, %s)',
                    (patient_id, patient_id, 'Ещё раз замерила, 4,1.'))

    item = conversations(client)[0]
    assert item['unread'] == 2
    assert item['lastMessage']['body'] == 'Ещё раз замерила, 4,1.'
    assert item['lastMessage']['mine'] is False


def test_doctor_sent_message_becomes_last(client, demo):
    login(client, 'doctor@demo.ru')
    patient_id = kovalova_id(client)
    assert client.post(f'/api/doctor/patients/{patient_id}/messages',
                       json={'body': 'Повторите замер через 15 минут.'}).status_code == 201

    item = conversations(client)[0]
    assert item['lastMessage']['body'] == 'Повторите замер через 15 минут.'
    assert item['lastMessage']['mine'] is True


def test_dialogs_show_only_own_patients_and_require_doctor(client, make_client, demo):
    assert client.get('/api/doctor/messages').status_code == 401
    login(client, '+79000000102')
    assert client.get('/api/doctor/messages').status_code == 403

    other = make_client()
    create_doctor(other)
    assert other.get('/api/doctor/messages').get_json()['conversations'] == []
