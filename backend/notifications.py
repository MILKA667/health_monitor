"""Уведомления через Telegram-бота: личная привязка chat_id к учётной записи."""
import json
import os
import sys
import urllib.error
import urllib.request

from flask import current_app

TELEGRAM_API = 'https://api.telegram.org/bot{token}/{method}'
DEFAULT_BOT_USERNAME = 'health_monitor_vyatgu_bot'

# В тестах уведомления не отправляются в сеть, а складываются сюда
SENT = []


def log_warning(message):
    try:
        current_app.logger.warning(message)
    except RuntimeError:
        print(message, file=sys.stderr)


def bot_username():
    return os.environ.get('TELEGRAM_BOT_USERNAME') or DEFAULT_BOT_USERNAME


def bot_token():
    return os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()


def api_call(method, payload, timeout=5):
    """Вызов Bot API; ошибки не пробрасываем — уведомление не должно ломать запрос."""
    token = bot_token()
    if not token:
        log_warning('Telegram: TELEGRAM_BOT_TOKEN не задан')
        return {'ok': False, 'description': 'token missing'}
    request = urllib.request.Request(
        TELEGRAM_API.format(token=token, method=method),
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        log_warning(f"Telegram API {method}: {error.read().decode('utf-8', 'replace')}")
    except (urllib.error.URLError, TimeoutError) as error:
        log_warning(f'Telegram API {method} недоступен: {error}')
    return {'ok': False, 'description': 'request failed'}


def chat_id_for(cur, user_id=None, phone=None):
    """chat_id привязанного пользователя по id или по телефону (для близкого без аккаунта)."""
    if user_id:
        cur.execute(
            'SELECT telegram_chat_id FROM users WHERE id = %s AND deleted_at IS NULL AND is_blocked = FALSE',
            (user_id,),
        )
    elif phone:
        cur.execute(
            'SELECT telegram_chat_id FROM users WHERE phone = %s AND deleted_at IS NULL AND is_blocked = FALSE',
            (phone,),
        )
    else:
        return None
    row = cur.fetchone()
    return row['telegram_chat_id'] if row else None


def notify(cur, text, user_id=None, phone=None):
    """Отправляет уведомление в Telegram, если получатель привязан. Возвращает True/False.

    Если привязки нет — ничего не отправляем (осознанное решение: без Telegram
    уведомление не доставляется, администратор может выдать новый пароль).
    """
    chat_id = chat_id_for(cur, user_id=user_id, phone=phone)
    if not chat_id:
        return False
    if current_app.config.get('TESTING'):
        SENT.append({'chat_id': chat_id, 'user_id': user_id, 'phone': phone, 'text': text})
        return True
    result = api_call('sendMessage', {'chat_id': chat_id, 'text': text})
    return bool(result.get('ok'))