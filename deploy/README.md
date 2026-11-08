# Деплой HealthMonitor

Пайплайн `.github/workflows/ci.yml`:

| Событие | Что происходит |
|---|---|
| push в любую ветку `feature/**`, `develop`, PR | фронтенд: ESLint, Vitest, сборка; бэкенд: pytest на PostgreSQL 16 |
| push в `main` (слияние PR) | то же, затем сборка Docker-образов в GHCR и выкатка на сервер по SSH |

Деплой запускается только если оба набора тестов зелёные. На сервере работают три контейнера: PostgreSQL, Flask (gunicorn) и nginx, который отдаёт фронтенд и проксирует `/api`.

## 1. Подготовка сервера (один раз)

VPS с Linux в РФ (требование 152-ФЗ). Нужны Docker и плагин compose:

```sh
curl -fsSL https://get.docker.com | sh
sudo useradd -m -s /bin/bash deploy && sudo usermod -aG docker deploy
sudo mkdir -p /opt/healthmonitor && sudo chown deploy: /opt/healthmonitor
```

Ключ для GitHub Actions (на своей машине):

```sh
ssh-keygen -t ed25519 -f healthmonitor_deploy -N ""
ssh-copy-id -i healthmonitor_deploy.pub deploy@<сервер>
```

Файл настроек на сервере — `/opt/healthmonitor/.env` по образцу [`.env.example`](.env.example). Пароль БД и `SECRET_KEY` сгенерируйте заново, в репозиторий их не кладите.

## 2. Секреты GitHub

Settings → Environments → создать **production**, в нём:

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | IP или домен сервера |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | содержимое приватного ключа `healthmonitor_deploy` |
| `DEPLOY_PORT` | порт SSH, если не 22 (необязательно) |

Переменная окружения (Variables) `DEPLOY_PATH` — если каталог не `/opt/healthmonitor`.

Пока `DEPLOY_HOST` не задан, пайплайн собирает и публикует образы, а выкатку пропускает с предупреждением.

## 3. Первый запуск

После первого успешного деплоя создайте администратора:

```sh
cd /opt/healthmonitor
docker compose exec backend flask --app app create-user --role admin --name "Администратор" --email admin@clinic.ru
```

Демо-данные (`seed-demo`) на продакшене не запускайте.

## HTTPS

nginx в контейнере слушает HTTP. Для HTTPS поставьте перед ним прокси на хосте (Caddy или nginx + certbot), задайте в `.env` `WEB_PORT=8080` и `SESSION_COOKIE_SECURE=1`.

## Откат

Каждый образ помечен SHA коммита. Вернуть предыдущую версию:

```sh
cd /opt/healthmonitor
IMAGE_TAG=<sha предыдущего коммита> docker compose up -d
```

Схема БД меняется только добавлением таблиц и колонок, поэтому старая версия бэкенда с новой схемой работает.

## Резервные копии

```sh
docker compose exec -T db pg_dump -U healthmonitor health_monitor | gzip > backup-$(date +%F).sql.gz
```
