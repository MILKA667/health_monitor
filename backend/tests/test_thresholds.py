from copy import deepcopy

from helpers import create_doctor, login

from db import db_cursor

DIABETES = {'type': 'nosology', 'id': 'diabetes'}

ROWS = [
    {'metric': 'glucose', 'critLow': '3,9', 'warnLow': '4,4', 'warnHigh': '10,0', 'critHigh': '13,9'},
    {'metric': 'bp_sys', 'critLow': '90', 'warnLow': '100', 'warnHigh': '140', 'critHigh': '160'},
    {'metric': 'bp_dia', 'critLow': None, 'warnLow': None, 'warnHigh': '90', 'critHigh': '100'},
    {'metric': 'pef', 'critLow': '50', 'warnLow': '80', 'warnHigh': None, 'critHigh': None},
]
SETTINGS = {'smsRelative': True, 'noDataAlert': True}


def patient_id(client):
    scopes = client.get('/api/doctor/thresholds').get_json()['scopes']['patients']
    return next(item['id'] for item in scopes if item['label'] == 'Пациент: Ковалёва Н. П.')


def patient_scope(client):
    return {'type': 'patient', 'id': patient_id(client)}


def save(client, scope, rows=None, settings=None):
    return client.post('/api/doctor/thresholds', json={
        'scope': scope, 'rows': rows if rows is not None else deepcopy(ROWS), 'settings': settings or SETTINGS,
    })


def values(client, scope):
    query = f"?scope={scope['type']}&id={scope['id']}" if scope else ''
    data = client.get(f'/api/doctor/thresholds{query}').get_json()
    return {row['metric']: row['values'] for row in data['rows']}, data['settings'], data


def test_thresholds_defaults(client, demo):
    login(client, 'doctor@demo.ru')
    rows, settings, data = values(client, {})

    # По умолчанию открыт первый пациент списка по алфавиту
    first = data['scopes']['patients'][0]
    assert data['scope'] == {'type': 'patient', 'id': first['id'], 'label': 'Пациент: Захаров М. С.'}
    assert rows['glucose'] == {'crit_low': '3,9', 'warn_low': '4,4', 'warn_high': '10,0', 'crit_high': '13,9'}
    assert rows['bp_dia'] == {'crit_low': None, 'warn_low': None, 'warn_high': '90', 'crit_high': '100'}
    assert rows['pef'] == {'crit_low': '50', 'warn_low': '80', 'warn_high': None, 'crit_high': None}
    assert settings == {'smsRelative': True, 'noDataAlert': True}
    assert len(data['scopes']['patients']) == 9
    assert [item['label'] for item in data['scopes']['nosologies']] == [
        'Шаблон: сахарный диабет', 'Шаблон: гипертония', 'Шаблон: астма']


def test_thresholds_of_selected_patient(client, demo):
    login(client, 'doctor@demo.ru')
    _, _, data = values(client, patient_scope(client))
    assert data['scope']['label'] == 'Пациент: Ковалёва Н. П.'
    assert [row['label'] for row in data['rows']] == [
        'Глюкоза крови', 'Давление, верхнее', 'Давление, нижнее', 'Пиковая скорость выдоха']


def test_save_patient_thresholds(client, demo):
    login(client, 'doctor@demo.ru')
    scope = patient_scope(client)
    rows = deepcopy(ROWS)
    rows[0].update(warnHigh='6,0', critHigh='8,0')

    response = save(client, scope, rows, {'smsRelative': False, 'noDataAlert': True})
    assert response.status_code == 200
    assert response.get_json()['savedAt']
    assert response.get_json()['settings'] == {'smsRelative': False, 'noDataAlert': True}

    saved, settings, _ = values(client, scope)
    assert saved['glucose']['warn_high'] == '6,0' and settings['smsRelative'] is False

    record = client.get(f"/api/doctor/patients/{scope['id']}/record?days=14").get_json()
    assert record['thresholds'][1] == {'label': 'Цель', 'value': '4,4–6,0 ммоль/л'}

    with db_cursor() as cur:
        cur.execute("SELECT object FROM audit_log WHERE action = 'thresholds_saved'")
        assert cur.fetchone()['object'] == f"patient:{scope['id']}"


def test_thresholds_validation(client, demo):
    login(client, 'doctor@demo.ru')
    scope = patient_scope(client)

    descending = deepcopy(ROWS)
    descending[0].update(warnLow='12,0')
    assert 'возрастать' in save(client, scope, descending).get_json()['error']

    text = deepcopy(ROWS)
    text[1].update(warnHigh='высоко')
    assert 'числами' in save(client, scope, text).get_json()['error']

    outside = deepcopy(ROWS)
    outside[0].update(critHigh='95')
    assert 'диапазона' in save(client, scope, outside).get_json()['error']

    assert save(client, scope, deepcopy(ROWS)[:3]).status_code == 400

    with db_cursor() as cur:
        cur.execute('SELECT count(*) AS n FROM thresholds')
        assert cur.fetchone()['n'] == 0


def test_empty_values_restore_defaults(client, demo):
    login(client, 'doctor@demo.ru')
    scope = patient_scope(client)
    rows = deepcopy(ROWS)
    rows[0] = {'metric': 'glucose', 'critLow': '', 'warnLow': None, 'warnHigh': ' ', 'critHigh': None}
    assert save(client, scope, rows).status_code == 200

    saved, _, _ = values(client, scope)
    assert saved['glucose'] == {'crit_low': '3,9', 'warn_low': '4,4', 'warn_high': '10,0', 'crit_high': '13,9'}
    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM thresholds WHERE metric = 'glucose'")
        assert cur.fetchone()['n'] == 0


def test_nosology_template_applies_to_patients(client, demo):
    login(client, 'doctor@demo.ru')
    scope = patient_scope(client)
    rows = deepcopy(ROWS)
    rows[0].update(warnHigh='7,0', critHigh='9,0')

    assert save(client, DIABETES, rows, {'smsRelative': True, 'noDataAlert': False}).status_code == 200
    saved, settings, data = values(client, DIABETES)
    assert data['scope']['label'] == 'Шаблон: сахарный диабет'
    assert saved['glucose']['warn_high'] == '7,0' and settings['noDataAlert'] is False

    # Пациент без собственных порогов наследует шаблон
    inherited, inherited_settings, _ = values(client, scope)
    assert inherited['glucose']['crit_high'] == '9,0' and inherited_settings['noDataAlert'] is False
    record = client.get(f"/api/doctor/patients/{scope['id']}/record?days=14").get_json()
    assert record['thresholds'][1]['value'] == '4,4–7,0 ммоль/л'

    # Свои пороги пациента важнее шаблона
    own = deepcopy(ROWS)
    own[0].update(warnHigh='6,0')
    assert save(client, scope, own).status_code == 200
    saved, _, _ = values(client, scope)
    assert saved['glucose']['warn_high'] == '6,0'


def test_foreign_patient_and_roles(client, demo):
    assert client.get('/api/doctor/thresholds').status_code == 401
    login(client, 'doctor@demo.ru')
    foreign_patient = patient_id(client)

    create_doctor(client)
    assert client.get(f'/api/doctor/thresholds?scope=patient&id={foreign_patient}').status_code == 404
    assert save(client, {'type': 'patient', 'id': foreign_patient}).status_code == 404
    # Шаблоны общие для всех врачей
    assert client.get('/api/doctor/thresholds?scope=nosology&id=asthma').status_code == 200