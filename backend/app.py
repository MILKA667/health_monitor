import os
import secrets
from datetime import timedelta
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

import auth
import doctor
import seed
import welcome
from db import apply_schema, get_db_connection

# Настройки БД и SECRET_KEY — в backend/.env (образец: .env.example)
load_dotenv(Path(__file__).parent / '.env')


app = Flask(__name__)
app.config.update(
    # В продакшене SECRET_KEY обязателен, иначе сессии сбрасываются при каждом перезапуске
    SECRET_KEY=os.environ.get('SECRET_KEY') or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE') == '1',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
# За nginx (docker compose) берём IP клиента из X-Forwarded-For — иначе лимит входов общий на всех
if os.environ.get('BEHIND_PROXY') == '1':
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
CORS(app, supports_credentials=True, origins=os.environ.get('FRONTEND_ORIGIN', 'http://localhost:5173'))
app.register_blueprint(auth.bp)
app.register_blueprint(welcome.bp)
app.register_blueprint(doctor.bp)
app.cli.add_command(seed.seed_demo)


@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        return jsonify({'status': 'healthy'}), 200
    except Exception as e:
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 500


@app.cli.command('init-db')
def init_db():
    """Создаёт таблицы из schema.sql."""
    apply_schema()
    click.echo('Таблицы созданы.')


@app.cli.command('create-user')
@click.option('--role', type=click.Choice(['doctor', 'patient', 'relative', 'admin']), required=True)
@click.option('--name', required=True)
@click.option('--phone')
@click.option('--email')
@click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True)
@click.option('--temporary', is_flag=True, help='Временный пароль: после входа откроется /welcome')
def create_user_command(role, name, phone, email, password, temporary):
    """Создаёт учётную запись (например, первого администратора)."""
    if not phone and not email:
        raise click.UsageError('Нужен --phone или --email')
    try:
        user_id = auth.create_user(role, name, password, phone, email, temporary)
    except ValueError as e:
        raise click.ClickException(str(e))
    click.echo(f'Пользователь создан, id={user_id}')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
