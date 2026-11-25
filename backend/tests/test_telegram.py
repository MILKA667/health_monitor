from helpers import link_telegram, login

from bot import process_text
from db import db_cursor
from notifications import SENT


def test_status_and_link_code(client, demo):
    login(client, '+79000000102')
    status = client.get('/api/telegram/status').get_json()
    assert status == {'linked': False, 'botUsername': 'health_monitor_vyatgu_bot',
                      'botLink': 'https://t.me/health_monitor_vyatgu_bot'}

    payload = client.post('/api/telegram/link-code').get_json()
    assert len(payload['code']) == 6 and payload['code'].isdigit()
    assert payload['deepLink'].endswith(f"?start={payload['code']}")
    assert payload['expiresInMinutes'] == 10


def test_bot_links_and_unlinks_chat(client, demo):
    login(client, '+79000000102')
    code = client.post('/api/telegram/link-code').get_json()['code']

    with db_cursor() as cur:
        reply = process_text(cur, 555001, f'/start {code}')
    assert 'Готово' in reply
    assert client.get('/api/telegram/status').get_json()['linked'] is True

    with db_cursor() as cur:
        cur.execute('SELECT telegram_chat_id FROM users WHERE phone = %s', ('79000000102',))
        assert cur.fetchone()['telegram_chat_id'] == 555001
        assert 'Привязано' in process_text(cur, 555001, '/status')

    with db_cursor() as cur:
        assert 'отключены' in process_text(cur, 555001, '/stop')
    assert client.get('/api/telegram/status').get_json()['linked'] is False

    with db_cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE action IN ('telegram_linked', 'telegram_unlinked')")
        assert cur.fetchone()['n'] == 2


def test_bot_rejects_wrong_and_expired_code(client, demo):
    login(client, '+79000000102')
    code = client.post('/api/telegram/link-code').get_json()['code']
    wrong = '000000' if code != '000000' else '111111'

    with db_cursor() as cur:
        assert 'не подошёл' in process_text(cur, 555002, f'/start {wrong}')

    with db_cursor() as cur:
        cur.execute("UPDATE telegram_link_codes SET expires_at = now() - interval '1 minute'")
        assert 'не подошёл' in process_text(cur, 555002, f'/start {code}')
    assert client.get('/api/telegram/status').get_json()['linked'] is False


def test_notifications_only_when_linked(client, demo):
    login(client, '+79000000102')
    assert client.post('/api/patient/measurements', json={'kind': 'glucose', 'value': '3,1'}).status_code == 201
    assert SENT == []

    link_telegram('79000000001')  # лечащий врач
    assert client.post('/api/patient/measurements', json={'kind': 'glucose', 'value': '3,2'}).status_code == 201
    assert SENT and '3,2' in SENT[-1]['text']