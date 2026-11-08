#!/bin/sh
set -e

# Без постоянного ключа у каждого воркера свой ключ — сессии будут сбрасываться
: "${SECRET_KEY:?SECRET_KEY не задан}"
: "${DB_PASSWORD:?DB_PASSWORD не задан}"

# Схема идемпотентна: на каждом запуске досоздаются новые таблицы и колонки
flask --app app init-db

exec gunicorn --workers "${GUNICORN_WORKERS:-3}" --bind 0.0.0.0:5000 --access-logfile - app:app
