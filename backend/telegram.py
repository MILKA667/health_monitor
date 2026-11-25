"""Привязка Telegram: код, deep-link и статус для экрана «Telegram»."""
import secrets

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from db import audit, db_cursor
from notifications import bot_username
from security import current_user, error, login_required

bp = Blueprint('telegram', __name__, url_prefix='/api/telegram')

CODE_LIFETIME_MINUTES = 10


@bp.get('/status')
@login_required()
def status():
    user = current_user()
    with db_cursor() as cur:
        cur.execute('SELECT telegram_chat_id FROM users WHERE id = %s', (user['id'],))
        chat_id = cur.fetchone()['telegram_chat_id']
    return jsonify({
        'linked': bool(chat_id),
        'botUsername': bot_username(),
        'botLink': f'https://t.me/{bot_username()}',
    })


@bp.post('/link-code')
@login_required()
def link_code():
    """Одноразовый код: пользователь открывает бота по deep-link и нажимает Start."""
    user = current_user()
    code = f'{secrets.randbelow(10 ** 6):06d}'
    with db_cursor() as cur:
        cur.execute('DELETE FROM telegram_link_codes WHERE user_id = %s', (user['id'],))
        cur.execute(
            """INSERT INTO telegram_link_codes (user_id, code_hash, expires_at)
               VALUES (%s, %s, now() + make_interval(mins => %s))""",
            (user['id'], generate_password_hash(code), CODE_LIFETIME_MINUTES),
        )
        audit(cur, 'telegram_code_created', user['id'], None, request.remote_addr)
    username = bot_username()
    return jsonify({
        'code': code,
        'expiresInMinutes': CODE_LIFETIME_MINUTES,
        'botUsername': username,
        'deepLink': f'https://t.me/{username}?start={code}',
    })


@bp.delete('/link')
@login_required()
def unlink():
    user = current_user()
    with db_cursor() as cur:
        cur.execute('UPDATE users SET telegram_chat_id = NULL WHERE id = %s', (user['id'],))
        audit(cur, 'telegram_unlinked', user['id'], None, request.remote_addr)
    return jsonify({'linked': False})


def link_user_by_code(cur, code, chat_id):
    """Проверяет код из бота и привязывает chat_id. Возвращает имя пользователя или None."""
    if not code.isdigit() or len(code) != 6:
        return None
    cur.execute(
        """SELECT c.user_id, c.code_hash, u.name
           FROM telegram_link_codes c JOIN users u ON u.id = c.user_id
           WHERE c.expires_at > now() AND u.deleted_at IS NULL"""
    )
    for row in cur.fetchall():
        if check_password_hash(row['code_hash'], code):
            cur.execute('UPDATE users SET telegram_chat_id = %s WHERE id = %s', (chat_id, row['user_id']))
            cur.execute('DELETE FROM telegram_link_codes WHERE user_id = %s', (row['user_id'],))
            audit(cur, 'telegram_linked', row['user_id'], f'chat:{chat_id}')
            return row['name']
    return None