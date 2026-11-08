from helpers import login

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
    assert kovaleva['alert']['escalated'] is False
    assert patients['Савельев Игорь Андреевич']['alert']['escalated'] is True


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
    login(client, 'duty@demo.ru')
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


def test_duty_doctor_accepts_only_escalated(client, make_client, demo):
    owner = make_client()
    login(owner, 'doctor@demo.ru')
    patients = worklist(owner)
    escalated = patients['Савельев Игорь Андреевич']['alert']['id']
    pending = patients['Ковалёва Нина Петровна']['alert']['id']

    login(client, 'duty@demo.ru')
    assert client.post(f'/api/doctor/alerts/{pending}/accept', json={}).status_code == 404
    assert client.post(f'/api/doctor/alerts/{escalated}/accept', json={}).status_code == 200
    # Отменить может только тот, кто принял
    assert owner.post(f'/api/doctor/alerts/{escalated}/undo').status_code == 403


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
