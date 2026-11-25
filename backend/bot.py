"""Telegram-бот HealthMonitor: привязка аккаунта к чату и ответы на команды.

Запускается отдельным сервисом compose (entrypoint: python bot.py) с тем же
образом, что и backend, и тем же .env (токен, БД).
"""
import sys
import time

from db import audit, db_cursor
from notifications import api_call
from telegram import link_user_by_code

HELP = (
    'HealthMonitor.\n'
    'Чтобы получать уведомления, откройте в личном кабинете «Привязать Telegram» '
    'или отправьте /link КОД.\n'
    'Отвязать: /stop'
)


def process_text(cur, chat_id, text):
    """Обрабатывает команду и возвращает ответ; БД-операции — здесь, отправка — снаружи."""
    parts = (text or '').strip().split()
    if not parts:
        return HELP
    command = parts[0].split('@')[0].lower()

    if command in ('/start', '/link'):
        if len(parts) < 2:
            return ('Здравствуйте! Откройте ссылку «Привязать Telegram» в личном кабинете HealthMonitor '
                    'или отправьте /link КОД.')
        name = link_user_by_code(cur, parts[1], chat_id)
        if not name:
            return 'Код не подошёл или истёк. Получите новый в личном кабинете.'
        return f'Готово, {name}! Уведомления HealthMonitor будут приходить сюда.'

    if command in ('/stop', '/unlink'):
        cur.execute('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = %s RETURNING id', (chat_id,))
        row = cur.fetchone()
        if row:
            audit(cur, 'telegram_unlinked', row['id'], f'chat:{chat_id}')
            return 'Уведомления отключены. Чтобы вернуть, привяжите Telegram снова.'
        return 'Этот чат не привязан ни к одной учётной записи.'

    if command == '/status':
        cur.execute('SELECT name FROM users WHERE telegram_chat_id = %s AND deleted_at IS NULL', (chat_id,))
        row = cur.fetchone()
        return f'Привязано: {row["name"]}' if row else 'Этот чат не привязан ни к одной учётной записи.'

    return HELP


def handle_update(update, send=True):
    message = update.get('message') or {}
    chat = message.get('chat') or {}
    chat_id = chat.get('id')
    text = message.get('text') or ''
    if not chat_id or not text:
        return None
    with db_cursor() as cur:
        reply = process_text(cur, chat_id, text)
    if reply and send:
        api_call('sendMessage', {'chat_id': chat_id, 'text': reply})
    return reply


def main():
    print('HealthMonitor bot started', flush=True)
    offset = 0
    while True:
        result = api_call('getUpdates', {'offset': offset, 'timeout': 30}, timeout=40)
        if not result.get('ok'):
            time.sleep(3)
            continue
        for update in result.get('result', []):
            offset = update['update_id'] + 1
            try:
                handle_update(update)
            except Exception as error:  # бот не должен падать из-за одного сообщения
                print(f'update error: {error}', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()