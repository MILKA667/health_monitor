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
| Пациент, первый вход | +7 900 000-01-01 | temp1234 (временный) |
| Пациент | +7 900 000-01-02 | demo1234 |

Свою учётку: `flask --app app create-user --role admin --name "..." --email ...`.

## SMS

Шлюза пока нет: сообщения (коды восстановления, уведомления) пишутся в таблицу `sms_outbox` и в лог сервера.

## Тесты

```
venv\Scripts\pip install -r requirements-dev.txt
venv\Scripts\python -m pytest
```

Тесты создают отдельную базу `health_monitor_test` (имя меняется через `TEST_DB_NAME`) и очищают её перед каждым тестом — рабочие данные не затрагиваются. В CI тесты идут на PostgreSQL 16 из GitHub Actions.

Деплой — см. [`deploy/README.md`](../deploy/README.md).
