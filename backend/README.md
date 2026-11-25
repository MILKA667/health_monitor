# HealthMonitor — бэкенд

Flask + PostgreSQL. Фронтенд в dev-режиме проксирует `/api` на `localhost:5000`.

## Запуск

```
python -m venv venv
venv\Scripts\pip install -r requirments.txt
copy .env.example .env          # заполнить DB_PASSWORD и SECRET_KEY
venv\Scripts\flask --app app init-db
venv\Scripts\flask --app app seed-demo
venv\Scripts\python app.py
```

`init-db` и `seed-demo` можно запускать повторно — существующие данные не теряются.

## Демо-учётки (`seed-demo`)

| Роль | Логин | Пароль |
|---|---|---|
| Администратор | admin@demo.ru | demo1234 |
| Врач | doctor@demo.ru | demo1234 |
| Родственник | relative@demo.ru | demo1234 |
| Пациент, первый вход | +7 900 000-01-01 | temp1234 (временный) |
| Пациент | +7 900 000-01-02 | demo1234 |

Свою учётку: `flask --app app create-user --role admin --name "..." --email ...`.

## Уведомления в Telegram

Все уведомления (коды восстановления, временные пароли, алерты врачу и родственнику) идут через бота
`@health_monitor_vyatgu_bot`. Пользователь привязывает чат в разделе «Telegram»: получает код в интерфейсе
и открывает deep-link бота. Без привязки уведомления не доставляются — администратор видит новый пароль
при сбросе и может передать его лично.

В `backend/.env` (и в `.env` на сервере) нужны:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=health_monitor_vyatgu_bot
```

Сервис `bot` в `deploy/docker-compose.yml` запускает long polling на том же образе, что и backend.

## Тесты

```
venv\Scripts\pip install -r requirements-dev.txt
venv\Scripts\python -m pytest
```

Тесты создают отдельную базу `health_monitor_test` (имя меняется через `TEST_DB_NAME`) и очищают её перед каждым тестом — рабочие данные не затрагиваются. В CI тесты идут на PostgreSQL 16 из GitHub Actions.

Деплой — см. [`deploy/README.md`](../deploy/README.md).
