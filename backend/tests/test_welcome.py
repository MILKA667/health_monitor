from helpers import login

from db import db_cursor

CONSENTS = {'personalData': True, 'noDiagnosis': True}


def complete(client, **override):
    body = {'password': 'Galina777x', 'consents': CONSENTS, 'relative': None, **override}
    return client.post('/api/welcome/complete', json=body)


def test_profile_for_first_login(client, demo):
    login(client, '+79000000101', 'temp1234')
    profile = client.get('/api/welcome/profile').get_json()
    assert profile['name'] == 'Петрова Галина Ивановна'
    assert profile['phoneMasked'] == '+7 ••• ••• 01 01'
    assert profile['doctor'] == {'name': 'Смирнова Елена Андреевна', 'shortName': 'Смирнова Е. А.',
                                 'specialty': 'эндокринолог'}


def test_only_patient_with_temporary_password(client, make_client, demo):
    assert client.get('/api/welcome/profile').status_code == 401
    login(client, 'doctor@demo.ru')
    assert client.get('/api/welcome/profile').status_code == 403

    patient = make_client()
    login(patient, '+79000000102')
    assert patient.get('/api/welcome/profile').status_code == 409


def test_password_rules(client, demo):
    login(client, '+79000000101', 'temp1234')
    birth_year = client.get('/api/welcome/profile').get_json()['birthDate'][-4:]
    assert complete(client, password='short1').status_code == 400
    assert complete(client, password=f'Galina{birth_year}').status_code == 400
    assert complete(client, password='Galina0101').status_code == 400


def test_consents_and_relative_required(client, demo):
    login(client, '+79000000101', 'temp1234')
    assert complete(client, consents={'personalData': True}).status_code == 400
    assert complete(client, relative={'name': 'Дмитрий, сын', 'phone': '12'}).status_code == 400


def test_complete(client, demo):
    login(client, '+79000000101', 'temp1234')
    response = complete(client, relative={'name': 'Дмитрий, сын', 'phone': '+7 901 222-33-44'})
    assert response.status_code == 200

    me = client.get('/api/auth/me').get_json()
    assert me['mustChangePassword'] is False
    with db_cursor() as cur:
        cur.execute('SELECT kind FROM consents ORDER BY id')
        assert [row['kind'] for row in cur.fetchall()] == ['personal_data', 'no_diagnosis', 'relative_sms']
        cur.execute('SELECT phone FROM patient_contacts WHERE patient_id = %s', (me['id'],))
        assert cur.fetchone()['phone'] == '79012223344'
    assert login(client, '+79000000101', 'Galina777x')['mustChangePassword'] is False
