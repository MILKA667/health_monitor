# Тесты HealthMonitor

Два набора: backend — pytest (107 кейсов), frontend — Vitest (70 кейсов).
Оба запускаются в CI на каждый push и pull request.

## Как запустить

```powershell
# Backend
cd backend
venv\Scripts\pip install -r requirements-dev.txt
venv\Scripts\python -m pytest -q

# Frontend
cd ..\frontend
npm run lint
npm test
npm run build
```

Ожидаемый результат: `107 passed` и `70 passed`, lint и build без ошибок.

## Где лежат

### Backend — `backend/tests/`

| Файл | Кейсов | Что проверяет |
|---|---|---|
| `test_auth.py` | 14 | Вход по e-mail и телефону, временный пароль, неверный пароль (общий текст), лимит попыток, блокировка, `/me` и выход, заявка, дубликат, валидация, восстановление пароля (полный цикл, лимиты кода, неизвестный логин, требование Telegram) |
| `test_welcome.py` | 5 | Первый вход пациента: профиль, только пациент с временным паролем, правила пароля, согласия и близкий, завершение |
| `test_doctor.py` | 18 | Права, рабочий список, счётчик, сводка, чужой пациент, принять/отменить алерт, чужой врач, уведомления, «нет данных», медкарта, график, приверженность, сообщения, журнал алертов, страница алертов |
| `test_monitoring.py` | 6 | Пороги глюкозы (параметризовано), давление (худшее из двух), ПСВ, формат значений, пороги пациента, неизменяемость измерений |
| `test_patient.py` | 22 | Главная, лекарства, ввод показателя (критичный/в норме), валидация, последний алерт, чужой слот, история, напоминания (5), чат (3), профиль, устройства, смена пароля |
| `test_relative.py` | 4 | Главная, push-переключатель, отсутствие лишнего доступа, без связи |
| `test_admin.py` | 12 | Права, заявки, одобрение пациента/родственника/врача, отклонение и отмена, пользователи и блокировка, аудит, сброс пароля, удаление, повторное одобрение, дашборд метрик |
| `test_messages.py` | 5 | Диалоги, прочитано, ответ пациента, последнее сообщение, только свои пациенты |
| `test_reports.py` | 5 | Отчёт пациента, валидация, групповой, отчёт по реакции, список и доступ |
| `test_thresholds.py` | 7 | Значения по умолчанию, пороги пациента, сохранение, валидация, сброс, шаблон нозологии, чужой пациент |
| `test_telegram.py` | 4 | Статус и код, привязка/отвязка, неверный/просроченный код, уведомления только при привязке |

### Frontend — `frontend/src/**/*.test.jsx`

24 файла, 70 кейсов. Страницы: Login, Admin, Analytics, Alerts, Messages, Telegram, Thresholds,
Reports, Report, Record, RelativeHome, WorklistGroup. Пациент: Home, Entry, Alert, History,
Reminders, Chat, Profile, Devices, Password. Общее: NewPassword, маршруты App, `format`, `password`.

## Как устроена изоляция

**Backend.** `backend/tests/conftest.py` подменяет базу на `health_monitor_test`
(имя меняется через `TEST_DB_NAME`), создаёт её при необходимости, применяет схему
и очищает все таблицы перед каждым тестом (`TRUNCATE ... RESTART IDENTITY CASCADE`).
Рабочая база не затрагивается. Фикстура `demo` наполняет базу через `flask seed-demo`,
фикстура `client` даёт тестовый клиент Flask. Уведомления в тестах не уходят в сеть:
`notifications.SENT` собирает их в память.

**Frontend.** Vitest + jsdom + Testing Library. API-модули подменяются через `vi.mock`,
поэтому тесты не зависят от запущенного backend. `src/test/setup.js` подключает
`jest-dom` и очищает DOM после каждого теста.

## Что показать преподавателю

1. **Запуск вживую** — команды выше, в выводе `106 passed` и `69 passed`.
2. **Интеграционный тест API** — `backend/tests/test_doctor.py::test_alerts_page`:
   проверяет страницу алертов через настоящий HTTP-клиент Flask и реальную БД.
3. **Тест бизнес-логики** — `backend/tests/test_monitoring.py::test_glucose_levels`:
   параметризованный, проверяет границы порогов.
4. **Тест UI** — `frontend/src/pages/Alerts/Alerts.test.jsx`: рендер, вкладки,
   принятие алерта, вызов API через мок.
5. **CI** — вкладка Actions в GitHub: тесты запускаются автоматически, при падении
   деплой не выполняется.

### Демонстрация, что тесты ловят регрессию

Можно временно сломать правило и показать падение:

```powershell
# В backend/monitoring.py поменять порог 3.9 на 1.0, затем:
cd backend
venv\Scripts\python -m pytest tests/test_monitoring.py -q
# ожидаемо: падение test_glucose_levels
```

После демонстрации изменение откатить.

## Чего тестами не покрыто

- Страницы `Register`, `Recover`, `FirstLogin`, `Worklist` (сама страница; её группа
  и карточка покрыты).
- Компоненты `AlertBar`, `AuthLayout`, `Button`, `Chart`, `Choice`, `ConsentText`,
  `DoctorLayout`, `Field`, `FormError`, `Header`, `Panel`, `PatientLayout`,
  `PatientTabBar`, `SegmentedControl`, `StatusMarker`, `StepProgress`, `TextTabs`,
  `ValueCell`.
- E2E-тесты в браузере (Playwright/Cypress) отсутствуют.
