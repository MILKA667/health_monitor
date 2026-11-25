from helpers import create_doctor, login

from db import db_cursor

def patient_payload(client):
    patients = client.get('/api/doctor/reports').get_json()['options']['patients']
    patient_id = next(item['id'] for item in patients if item['label'] == 'Ковалёва Н. П.')
    return {'kind': 'patient', 'patientId': patient_id, 'days': 14,
            'sections': ['dynamics', 'alerts', 'meds', 'messages']}


def create(client, **payload):
    return client.post('/api/doctor/reports', json=payload)


def test_create_patient_report(client, demo):
    login(client, 'doctor@demo.ru')
    response = create(client, **patient_payload(client))
    assert response.status_code == 201
    report = response.get_json()
    assert report['title'] == 'По пациенту · Ковалёва Н. П.'
    assert report['days'] == 14
    assert len(report['periodText']) == 16
    assert [section['id'] for section in report['sections']] == ['dynamics', 'alerts', 'meds', 'messages']

    detail = client.get(f"/api/doctor/reports/{report['id']}").get_json()
    assert detail['doctor'] == {'name': 'Смирнова Е. А.', 'specialty': 'эндокринолог',
                                'clinic': 'Городская поликлиника № 3'}
    patient = detail['patient']
    assert (patient['name'], patient['sex'], patient['age'], patient['icdCode']) == (
        'Ковалёва Нина Петровна', 'жен.', 67, 'E11.9')
    assert patient['dynamics']['stats'][0] == {'label': 'Среднее', 'value': '3,7'}
    assert patient['dynamics']['measurements'][0]['value'] == '2,9'
    assert patient['dynamics']['measurements'][0]['context'] == 'натощак'
    assert len(patient['alerts']) == 3
    assert patient['meds'][0]['percent'] == 93
    assert len(patient['messages']) == 3

    with db_cursor() as cur:
        cur.execute("SELECT action FROM audit_log WHERE action LIKE 'report%' ORDER BY id")
        assert [row['action'] for row in cur.fetchall()] == ['report_created', 'report_viewed']


def test_report_validation(client, demo):
    login(client, 'doctor@demo.ru')
    payload = patient_payload(client)
    assert 'раздел' in create(client, **{**payload, 'sections': []}).get_json()['error']
    assert 'тип' in create(client, **{**payload, 'kind': 'other'}).get_json()['error']
    assert 'Период' in create(client, **{**payload, 'days': 7}).get_json()['error']
    assert 'Выберите пациента' in create(client, **{**payload, 'patientId': None}).get_json()['error']
    assert create(client, **{**payload, 'patientId': 999}).status_code == 404


def test_group_report_filters_nosology(client, demo):
    login(client, 'doctor@demo.ru')
    report = create(client, kind='group', nosology='diabetes', days=30, sections=['dynamics']).get_json()
    assert report['title'] == 'По группе пациентов · сахарный диабет'

    group = client.get(f"/api/doctor/reports/{report['id']}").get_json()['group']
    assert group['totals']['patients'] == 4
    assert [row['name'] for row in group['rows']] == [
        'Ковалёва Нина Петровна', 'Лебедева Ольга Ивановна', 'Петрова Галина Ивановна', 'Фёдоров Виктор Павлович']
    kovaleva = group['rows'][0]
    assert (kovaleva['measurements'], kovaleva['outOfTarget'], kovaleva['outPercent']) == (4, 3, 75)
    assert group['totals']['measurements'] == 11

    everything = create(client, kind='group', nosology='all', days=30, sections=['alerts']).get_json()
    assert everything['title'] == 'По группе пациентов · все нозологии'
    assert client.get(f"/api/doctor/reports/{everything['id']}").get_json()['group']['totals']['patients'] == 9


def test_response_report(client, demo):
    login(client, 'doctor@demo.ru')
    report = create(client, kind='response', days=90, sections=['alerts']).get_json()
    response = client.get(f"/api/doctor/reports/{report['id']}").get_json()['response']

    assert response['summary'] == {'total': 15, 'crit': 5, 'accepted': 10, 'avgResponseMinutes': 17}
    assert response['rows'][0]['patientName'] == 'Ковалёва Нина Петровна'
    assert response['rows'][0]['responseMinutes'] is None


def test_reports_list_and_access(client, make_client, demo):
    login(client, 'doctor@demo.ru')
    first = create(client, **patient_payload(client)).get_json()
    create(client, kind='response', days=14, sections=['alerts'])
    listing = client.get('/api/doctor/reports').get_json()
    assert [report['title'] for report in listing['reports']] == [
        'Реакция на алерты · отделение', 'По пациенту · Ковалёва Н. П.']
    assert len(listing['options']['patients']) == 9
    assert listing['options']['periods'] == [14, 30, 90]

    other = make_client()
    create_doctor(other)
    assert other.get(f"/api/doctor/reports/{first['id']}").status_code == 404
    assert other.get('/api/doctor/reports').get_json()['reports'] == []
