"""Переписка пациента с врачом. Родственник переписку не видит."""
from security import short_name

MAX_MESSAGE_LENGTH = 2000


def message_json(row, reader_id):
    return {
        'id': row['id'],
        'body': row['body'],
        'createdAt': row['created_at'].isoformat(),
        'author': row['sender_name'],
        'authorShort': short_name(row['sender_name']),
        'senderRole': row['sender_role'],
        'mine': row['sender_id'] == reader_id,
        'read': row['read_at'] is not None,
    }


def messages_for(cur, patient_id, limit=200):
    """История переписки по пациенту — от старых к новым."""
    cur.execute(
        """SELECT m.*, u.name AS sender_name, u.role AS sender_role
           FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.patient_id = %s
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT %s""",
        (patient_id, limit),
    )
    return list(reversed(cur.fetchall()))


def add_message(cur, patient_id, sender_id, body):
    """Сохраняет сообщение; ValueError — текст для пользователя."""
    body = (body or '').strip()
    if not body:
        raise ValueError('Введите сообщение.')
    if len(body) > MAX_MESSAGE_LENGTH:
        raise ValueError(f'Сообщение длиннее {MAX_MESSAGE_LENGTH} символов.')
    cur.execute(
        """INSERT INTO messages (patient_id, sender_id, body) VALUES (%s, %s, %s) RETURNING id""",
        (patient_id, sender_id, body),
    )
    message_id = cur.fetchone()['id']
    cur.execute(
        """SELECT m.*, u.name AS sender_name, u.role AS sender_role
           FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = %s""",
        (message_id,),
    )
    return cur.fetchone()


def mark_read(cur, patient_id, reader_id):
    """Сообщения собеседника считаются прочитанными при открытии переписки."""
    cur.execute(
        """UPDATE messages SET read_at = now()
           WHERE patient_id = %s AND sender_id <> %s AND read_at IS NULL""",
        (patient_id, reader_id),
    )
