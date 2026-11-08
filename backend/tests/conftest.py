"""Тесты идут на отдельной базе (TEST_DB_NAME, по умолчанию health_monitor_test).
Если её нет, она создаётся; перед каждым тестом все таблицы очищаются."""
import os
from pathlib import Path

import psycopg2
import pytest
from dotenv import load_dotenv

# Подключение берём из backend/.env, но базу подменяем на тестовую — рабочие данные не трогаем
load_dotenv(Path(__file__).parent.parent / '.env')
os.environ['DB_NAME'] = os.environ.get('TEST_DB_NAME', 'health_monitor_test')
os.environ.setdefault('SECRET_KEY', 'test-secret')

from app import app as flask_app  # noqa: E402
from db import apply_schema, db_cursor  # noqa: E402


def create_database_if_missing():
    conn = psycopg2.connect(
        dbname='postgres',
        user=os.environ.get('DB_USER'),
        password=os.environ.get('DB_PASSWORD'),
        host=os.environ.get('DB_HOST', 'localhost'),
    )
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (os.environ['DB_NAME'],))
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{os.environ["DB_NAME"]}"')
    conn.close()


@pytest.fixture(scope='session', autouse=True)
def database():
    create_database_if_missing()
    apply_schema()


@pytest.fixture(autouse=True)
def clean_tables(database):
    with db_cursor() as cur:
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        tables = ', '.join(row['tablename'] for row in cur.fetchall())
        cur.execute(f'TRUNCATE {tables} RESTART IDENTITY CASCADE')


@pytest.fixture
def app():
    flask_app.config['TESTING'] = True
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def make_client(app):
    return app.test_client


@pytest.fixture
def demo(app):
    """Демо-данные из seed-demo: врачи, пациенты с измерениями и алертами."""
    result = app.test_cli_runner().invoke(args=['seed-demo'])
    assert result.exit_code == 0, result.output

