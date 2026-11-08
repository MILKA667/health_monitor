from helpers import last_sms_code, login

from db import db_cursor

APPLICATION = {
    'role': 'doctor',
    'name': 'Иван Иванов',
    'phone': '+7 901 000-00-00',
    'email': '',
    'extra': 'Терапевт, ГП №1',
    'consents': {'personalData': True, 'noDiagnosis': True},
}


def test_login_by_email_and_phone(client, demo):
    assert login(client, 'DOCTOR@demo.ru') == {'role': 'doctor', 'mustChangePassword': False}
    assert login(client, '8 (900) 000-00-01')['role'] == 'doctor'


def test_login_temporary_password(client, demo):
    assert login(client, '+79000000101', 'temp1234') == {'role': 'patient', 'mustChangePassword': True}


def test_login_wrong_password_is_generic(client, demo):
    wrong = client.post('/api/auth/login', json={'login': 'doctor@demo.ru', 'password': 'nope'})
    unknown = client.post('/api/auth/login', json={'login': 'nobody@demo.ru', 'password': 'nope'})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.get_json() == unknown.get_json()


def test_login_rate_limit(client, demo):
    for _ in range(5):
        client.post('/api/auth/login', json={'login': 'doctor@demo.ru', 'password': 'nope'})
    response = client.post('/api/auth/login', json={'login': 'doctor@demo.ru', 'password': 'demo1234'})
    assert response.status_code == 429


def test_blocked_user_cannot_login(client, demo):
    with db_cursor() as cur:
        cur.execute("UPDATE users SET is_blocked = TRUE WHERE email = 'doctor@demo.ru'")
    response = client.post('/api/auth/login', json={'login': 'doctor@demo.ru', 'password': 'demo1234'})
    assert response.status_code == 403


def test_me_and_logout(client, demo):
    assert client.get('/api/auth/me').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/auth/me').get_json()['name'] == 'Смирнова Елена Андреевна'
    client.post('/api/auth/logout')
    assert client.get('/api/auth/me').status_code == 401


def test_register_application(client):
    response = client.post('/api/auth/register', json=APPLICATION)
    assert response.status_code == 201
    with db_cursor() as cur:
        cur.execute('SELECT role, phone, status FROM applications')
        assert cur.fetchone() == {'role': 'doctor', 'phone': '79010000000', 'status': 'pending'}

    duplicate = client.post('/api/auth/register', json=APPLICATION)
    assert duplicate.status_code == 409


def test_register_existing_user(client, demo):
    response = client.post('/api/auth/register', json={**APPLICATION, 'phone': '89000000001'})
    assert response.status_code == 409


def test_register_validation(client):
    cases = [
        {'consents': {'personalData': True}},
        {'extra': ''},
        {'email': 'not-an-email'},
        {'phone': '123'},
        {'role': 'admin'},
    ]
    for override in cases:
        response = client.post('/api/auth/register', json={**APPLICATION, **override})
        assert response.status_code == 400, override


def test_patient_application_ignores_extra(client):
    response = client.post('/api/auth/register', json={**APPLICATION, 'role': 'patient', 'extra': ''})
    assert response.status_code == 201


def test_recover_full_flow_ends_other_sessions(client, make_client, demo):
    other = make_client()
    login(other, 'doctor@demo.ru')

    assert client.post('/api/auth/recover/code', json={'login': 'doctor@demo.ru'}).get_json() == {
        'masked': '+7 ••• ••• 00 01'}
    token = client.post('/api/auth/recover/verify',
                        json={'login': 'doctor@demo.ru', 'code': last_sms_code()}).get_json()['token']

    weak = client.post('/api/auth/recover/reset', json={'token': token, 'password': 'short'})
    assert weak.status_code == 400
    # После ошибки в пароле токен остаётся действительным
    assert client.post('/api/auth/recover/reset', json={'token': token, 'password': 'NewPass123'}).status_code == 200
    assert client.post('/api/auth/recover/reset', json={'token': token, 'password': 'NewPass123'}).status_code == 400

    assert other.get('/api/auth/me').status_code == 401
    assert login(client, 'doctor@demo.ru', 'NewPass123')['role'] == 'doctor'


def test_recover_code_attempts_and_resend_limit(client, demo):
    client.post('/api/auth/recover/code', json={'login': 'doctor@demo.ru'})
    code = last_sms_code()
    wrong = '000000' if code != '000000' else '111111'

    assert client.post('/api/auth/recover/code', json={'login': 'doctor@demo.ru'}).status_code == 429

    left = [client.post('/api/auth/recover/verify', json={'login': 'doctor@demo.ru', 'code': wrong})
            .get_json()['attemptsLeft'] for _ in range(3)]
    assert left == [2, 1, 0]
    locked = client.post('/api/auth/recover/verify', json={'login': 'doctor@demo.ru', 'code': code})
    assert locked.status_code == 400 and locked.get_json()['attemptsLeft'] == 0


def test_recover_unknown_login(client, demo):
    assert client.post('/api/auth/recover/code', json={'login': 'nobody@demo.ru'}).status_code == 404
