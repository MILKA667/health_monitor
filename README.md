# HealthMonitor

Платформа удалённого наблюдения за пациентами с сахарным диабетом, артериальной гипертонией и бронхиальной астмой.

Платформа **не ставит диагноз** и не даёт пациенту рекомендаций от своего имени. Персональные и медицинские данные
обрабатываются на серверах в РФ (152-ФЗ). Каждое действие с медданными пишется в неизменяемый журнал аудита,
измерения удалить нельзя.

## Структура

| Каталог | Что внутри |
|---|---|
| `frontend/` | React 19, Vite 8, react-router 7. |
| `backend/` | Flask + PostgreSQL: вход и заявки, медкарта, алерты, пороги, отчёты, экраны пациента и родственника, админка |
| `deploy/` | Docker Compose (PostgreSQL + gunicorn + nginx) и инструкция по выкатке |

## Быстрый старт
Нужны PostgreSQL 16+ и Python 3.13+.

```powershell
cd backend
python -m venv venv
venv\Scripts\pip install -r requirments.txt
copy .env.example .env          # заполнить DB_PASSWORD и SECRET_KEY
venv\Scripts\flask --app app init-db
venv\Scripts\flask --app app seed-demo
venv\Scripts\python app.py      # http://localhost:5000
```

```powershell
cd frontend
npm ci
npm run dev                     # http://localhost:5173
```

`init-db` и `seed-demo` можно запускать повторно — данные не дублируются.

## Демо-учётки (`seed-demo`)

| Роль | Логин | Пароль |
|---|---|---|
| Администратор | admin@demo.ru | demo1234 |
| Врач | doctor@demo.ru | demo1234 |
| Родственник | relative@demo.ru | demo1234 |
| Пациент, первый вход | +7 900 000-01-01 | temp1234 (временный) |
| Пациенты | +7 900 000-01-02 … 01-09 | demo1234 |

Свою учётку: `flask --app app create-user --role admin --name "..." --email ...`.

Уведомления доставляются через Telegram-бота **@health_monitor_vyatgu_bot**: пользователь открывает
раздел «Telegram», получает код и привязывает чат по deep-link. Без привязки уведомления не приходят.

Деплой — см. [`deploy/README.md`](deploy/README.md).
