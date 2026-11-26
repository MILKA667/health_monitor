import re

from helpers import login

from db import db_cursor

PATIENT_CARD = {'doctorId': 2, 'birthDate': '1980-05-12', 'sex': 'м', 'nosology': 'diabetes',
                'diagnosis': 'Сахарный диабет 2 типа', 'icdCode': 'E11.9'}


def applications(client):
    response = client.get('/api/admin/applications')
    assert response.status_code == 200, response.get_json()
    return {item['role']: item for item in response.get_json()['applications']}


def kovalova_patient_id(client):
    patients = client.get('/api/admin/applications').get_json()['patients']
    return next(item['id'] for item in patients if item['label'] == 'Ковалёва Н. П.')


def test_admin_requires_admin(client, demo):
    assert client.get('/api/admin/applications').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/admin/applications').status_code == 403
    assert client.get('/api/admin/users').status_code == 403
    assert client.get('/api/admin/audit').status_code == 403


def test_applications_list(client, demo):
    login(client, 'admin@demo.ru')
    data = client.get('/api/admin/applications').get_json()
    apps = {item['role']: item for item in data['applications']}

    assert set(apps) == {'doctor', 'relative', 'patient'}
    assert apps['doctor']['roleLabel'] == 'Врач' and apps['doctor']['status'] == 'pending'
    assert apps['relative']['phoneMasked'] == '+7 ••• ••• 01 03'
    assert apps['patient']['consentGiven'] is True
    assert [doctor['label'] for doctor in data['doctors']] == ['Смирнова Е. А.']
    assert len(data['patients']) == 9


def test_approve_patient_creates_account_and_card(client, make_client, demo):
    login(client, 'admin@demo.ru')
    app_id = applications(client)['patient']['id']

    response = client.post(f'/api/admin/applications/{app_id}/approve', json=PATIENT_CARD)
    assert response.status_code == 200
    user_id = response.get_json()['userId']

    with db_cursor() as cur:
        cur.execute('SELECT role, must_change_password FROM users WHERE id = %s', (user_id,))
        user = cur.fetchone()
        assert (user['role'], user['must_change_password']) == ('patient', True)
        cur.execute('SELECT doctor_id, diagnosis FROM patients WHERE user_id = %s', (user_id,))
        card = cur.fetchone()
        assert (card['doctor_id'], card['diagnosis']) == (2, 'Сахарный диабет 2 типа')
        cur.execute('SELECT status, approved_user_id FROM applications WHERE id = %s', (app_id,))
        application = cur.fetchone()
        assert (application['status'], application['approved_user_id']) == ('approved', user_id)

    password = response.get_json()['tempPassword']
    assert re.fullmatch(r'[A-Za-z0-9]{10}', password)
    patient = make_client()
    assert login(patient, '79000000777', password)['mustChangePassword'] is True


def test_approve_patient_requires_card(client, demo):
    login(client, 'admin@demo.ru')
    app_id = applications(client)['patient']['id']
    response = client.post(f'/api/admin/applications/{app_id}/approve', json={'sex': 'м'})
    assert response.status_code == 400
    assert 'врача' in response.get_json()['error']


def test_approve_relative_and_doctor(client, make_client, demo):
    login(client, 'admin@demo.ru')
    apps = applications(client)

    relative = client.post(f"/api/admin/applications/{apps['relative']['id']}/approve",
                            json={'patientId': kovalova_patient_id(client)})
    assert relative.status_code == 200
    relative_id = relative.get_json()['userId']
    with db_cursor() as cur:
        cur.execute('SELECT patient_id FROM relative_links WHERE relative_id = %s', (relative_id,))
        assert cur.fetchone()['patient_id'] == kovalova_patient_id(client)

    relative_client = make_client()
    login(relative_client, '79010000103', relative.get_json()['tempPassword'])
    assert relative_client.get('/api/relative/home').get_json()['patient']['name'] == 'Ковалёва Нина Петровна'

    doctor = client.post(f"/api/admin/applications/{apps['doctor']['id']}/approve",
                         json={'specialty': 'пульмонолог', 'clinic': 'Поликлиника № 3'})
    assert doctor.status_code == 200
    with db_cursor() as cur:
        cur.execute('SELECT specialty, clinic FROM doctors WHERE user_id = %s', (doctor.get_json()['userId'],))
        assert cur.fetchone() == {'specialty': 'пульмонолог', 'clinic': 'Поликлиника № 3'}


def test_reject_and_revert_release_access(client, demo):
    login(client, 'admin@demo.ru')
    apps = applications(client)

    assert client.post(f"/api/admin/applications/{apps['relative']['id']}/reject").status_code == 200
    assert applications(client)['relative']['status'] == 'rejected'
    assert client.post(f"/api/admin/applications/{apps['relative']['id']}/revert").status_code == 200
    assert applications(client)['relative']['status'] == 'pending'

    approved = client.post(f"/api/admin/applications/{apps['doctor']['id']}/approve",
                           json={'specialty': 'пульмонолог', 'clinic': 'Поликлиника № 3'}).get_json()['userId']
    assert client.post(f"/api/admin/applications/{apps['doctor']['id']}/revert").status_code == 200
    with db_cursor() as cur:
        cur.execute('SELECT is_blocked FROM users WHERE id = %s', (approved,))
        assert cur.fetchone()['is_blocked'] is True

    # Повторное одобрение возвращает доступ, не создавая вторую учётную запись
    assert client.post(f"/api/admin/applications/{apps['doctor']['id']}/approve",
                       json={'specialty': 'пульмонолог', 'clinic': 'Поликлиника № 3'}).get_json()['userId'] == approved
    with db_cursor() as cur:
        cur.execute('SELECT is_blocked FROM users WHERE id = %s', (approved,))
        assert cur.fetchone()['is_blocked'] is False


def test_users_filter_and_block(client, demo):
    login(client, 'admin@demo.ru')
    everyone = client.get('/api/admin/users').get_json()['users']
    assert any(user['role'] == 'relative' for user in everyone)
    assert any(user['isSelf'] for user in everyone)

    doctors = client.get('/api/admin/users?role=doctor').get_json()['users']
    assert {user['role'] for user in doctors} == {'doctor'}

    found = client.get('/api/admin/users?search=Ковалёва').get_json()['users']
    assert [user['name'] for user in found] == ['Ковалёва Нина Петровна']

    patient_id = found[0]['id']
    assert client.post(f'/api/admin/users/{patient_id}/block', json={'blocked': True}).get_json() == {'blocked': True}
    assert client.get('/api/admin/users?search=Ковалёва').get_json()['users'][0]['blocked'] is True
    assert client.post(f'/api/admin/users/{patient_id}/block', json={'blocked': False}).status_code == 200

    me = next(user['id'] for user in everyone if user['isSelf'])
    assert client.post(f'/api/admin/users/{me}/block', json={'blocked': True}).status_code == 400


def test_audit_groups(client, make_client, demo):
    login(client, 'admin@demo.ru')
    app_id = applications(client)['relative']['id']
    client.post(f'/api/admin/applications/{app_id}/reject')

    account = client.get('/api/admin/audit?type=account').get_json()
    assert any(event['action'] == 'Заявка отклонена' for event in account['events'])
    assert not any(event['action'] == 'Неудачная попытка входа' for event in account['events'])

    stranger = make_client()
    stranger.post('/api/auth/login', json={'login': 'admin@demo.ru', 'password': 'nope'})
    security = client.get('/api/admin/audit?type=security').get_json()
    events = security['events']
    assert events[0]['action'] == 'Неудачная попытка входа'
    assert events[0]['security'] is True
    assert {group['id'] for group in security['groups']} == {'all', 'data', 'account', 'security', 'notifications'}


def find_user(client, search):
    return client.get(f'/api/admin/users?search={search}').get_json()['users'][0]


def test_reset_password_by_admin(client, make_client, demo):
    login(client, 'admin@demo.ru')
    user = find_user(client, 'Ковалёва')
    other = make_client()
    login(other, '+79000000102')

    response = client.post(f"/api/admin/users/{user['id']}/reset-password")
    assert response.status_code == 200
    password = response.get_json()['password']
    assert re.fullmatch(r'[A-Za-z0-9]{10}', password)

    # Старые сеансы завершены, старый пароль больше не работает
    assert other.get('/api/patient/home').status_code == 401
    assert make_client().post('/api/auth/login', json={
        'login': '+79000000102', 'password': 'demo1234'}).status_code == 401

    patient = make_client()
    assert login(patient, '+79000000102', password)['role'] == 'patient'
    assert patient.get('/api/patient/home').status_code == 200

    me = find_user(client, 'Администратор клиники')
    assert client.post(f"/api/admin/users/{me['id']}/reset-password").status_code == 400

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'password_reset_by_admin'")
        assert cur.fetchone()['n'] == 1


def test_delete_user(client, make_client, demo):
    login(client, 'admin@demo.ru')
    user = find_user(client, 'Савельев')
    other = make_client()
    login(other, '+79000000103')

    assert client.post(f"/api/admin/users/{user['id']}/delete").status_code == 200
    assert other.get('/api/patient/home').status_code == 401
    assert make_client().post('/api/auth/login', json={
        'login': '+79000000103', 'password': 'demo1234'}).status_code == 401

    with db_cursor() as cur:
        cur.execute('SELECT name, phone, email, is_blocked, deleted_at FROM users WHERE id = %s', (user['id'],))
        row = cur.fetchone()
        assert row['name'] == 'Удалённая учётная запись'
        assert row['phone'] is None and row['email'] is None
        assert row['is_blocked'] is True and row['deleted_at'] is not None

    assert all(item['id'] != user['id'] for item in client.get('/api/admin/users').get_json()['users'])

    me = find_user(client, 'Администратор клиники')
    assert client.post(f"/api/admin/users/{me['id']}/delete").status_code == 400

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action = 'user_deleted'")
        assert cur.fetchone()['n'] == 1


def test_analytics_dashboard(client, demo):
    assert client.get('/api/admin/analytics').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/admin/analytics').status_code == 403

    login(client, 'admin@demo.ru')
    data = client.get('/api/admin/analytics?days=30').get_json()

    assert data['period']['days'] == 30
    assert data['users']['total'] >= 10
    assert data['users']['byRole']['doctor'] == 1
    assert data['engagement']['mau'] >= 1
    assert len(data['engagement']['daily']) == 31
    assert data['clinical']['measurements'] > 0
    assert data['clinical']['byKind']['glucose'] > 0
    assert data['alerts']['total'] > 0
    assert data['alerts']['acceptanceRate'] is not None
    assert data['quality']['nps'] is None
    assert data['monetization'] is None

    assert client.get('/api/admin/analytics?days=5').status_code == 400


def test_deleted_account_cannot_be_reapproved(client, demo):
    login(client, 'admin@demo.ru')
    app_id = applications(client)['relative']['id']
    patient_id = kovalova_patient_id(client)
    created = client.post(f'/api/admin/applications/{app_id}/approve', json={'patientId': patient_id})
    assert created.status_code == 200
    user_id = created.get_json()['userId']

    assert client.post(f'/api/admin/users/{user_id}/delete').status_code == 200
    assert client.post(f'/api/admin/applications/{app_id}/revert').status_code == 200
    response = client.post(f'/api/admin/applications/{app_id}/approve', json={'patientId': patient_id})
    assert response.status_code == 409
    assert 'удалена' in response.get_json()['error']
