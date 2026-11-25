from flask import current_app


def send_sms(cur, phone, text):
    """Ставит SMS в очередь. Шлюза пока нет — сообщение видно в sms_outbox и в логе сервера."""
    cur.execute('INSERT INTO sms_outbox (phone, text) VALUES (%s, %s)', (phone, text))
    current_app.logger.info('SMS → +%s: %s', phone, text)
