import os
from contextlib import contextmanager
from pathlib import Path

import psycopg2
import psycopg2.extras


def get_db_connection():
    return psycopg2.connect(
        dbname=os.environ.get('DB_NAME', 'health_monitor'),
        user=os.environ.get('DB_USER', 'admin'),
        password=os.environ.get('DB_PASSWORD', ''),
        host=os.environ.get('DB_HOST', 'localhost'),
    )


@contextmanager
def db_cursor():
    """Курсор со строками-словарями; коммит при успехе, откат при ошибке."""
    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur
    finally:
        conn.close()


def audit(cur, action, user_id=None, obj=None, ip=None, is_security=False):
    cur.execute(
        'INSERT INTO audit_log (user_id, action, object, ip, is_security) VALUES (%s, %s, %s, %s, %s)',
        (user_id, action, obj, ip, is_security),
    )


def apply_schema():
    """Создаёт таблицы из schema.sql; повторный запуск безопасен."""
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute((Path(__file__).parent / 'schema.sql').read_text(encoding='utf-8'))
    finally:
        conn.close()
