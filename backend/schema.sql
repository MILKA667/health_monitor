-- Схема для входа и заявок на доступ. Применяется командой `flask --app app init-db`.

CREATE TABLE IF NOT EXISTS users (
    id                    SERIAL PRIMARY KEY,
    role                  TEXT NOT NULL CHECK (role IN ('doctor', 'patient', 'relative', 'admin')),
    name                  TEXT NOT NULL,
    phone                 TEXT UNIQUE,
    email                 TEXT UNIQUE,
    password_hash         TEXT NOT NULL,
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
    is_blocked            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- Заявка — ещё не учётная запись: её одобряет или отклоняет администратор
CREATE TABLE IF NOT EXISTS applications (
    id                      SERIAL PRIMARY KEY,
    role                    TEXT NOT NULL CHECK (role IN ('doctor', 'patient', 'relative')),
    name                    TEXT NOT NULL,
    phone                   TEXT NOT NULL,
    email                   TEXT,
    extra                   TEXT NOT NULL DEFAULT '',
    consent_personal_data   BOOLEAN NOT NULL,
    consent_no_diagnosis    BOOLEAN NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал аудита неизменяем: только INSERT
CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     INTEGER REFERENCES users (id),
    action      TEXT NOT NULL,
    object      TEXT,
    ip          TEXT,
    is_security BOOLEAN NOT NULL DEFAULT FALSE
);

-- Версия сеансов: увеличивается при смене пароля, старые cookie перестают действовать
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS doctors (
    user_id    INTEGER PRIMARY KEY REFERENCES users (id),
    specialty  TEXT NOT NULL,
    clinic     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
    user_id      INTEGER PRIMARY KEY REFERENCES users (id),
    doctor_id    INTEGER NOT NULL REFERENCES doctors (user_id),
    birth_date   DATE NOT NULL,
    sex          TEXT NOT NULL CHECK (sex IN ('м', 'ж')),
    nosology     TEXT NOT NULL CHECK (nosology IN ('diabetes', 'hypertension', 'asthma')),
    diagnosis    TEXT NOT NULL,
    icd_code     TEXT NOT NULL,
    policy       TEXT,
    enrolled_at  DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Близкий, которому уходят SMS при критичном значении (с согласия пациента)
CREATE TABLE IF NOT EXISTS patient_contacts (
    patient_id  INTEGER PRIMARY KEY REFERENCES patients (user_id),
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    sms_alerts  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS consents (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    kind        TEXT NOT NULL CHECK (kind IN ('personal_data', 'no_diagnosis', 'relative_sms')),
    given_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

-- Коды восстановления пароля: 6 цифр, 10 минут, 3 попытки
CREATE TABLE IF NOT EXISTS recovery_codes (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    code_hash   TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Одноразовый токен на смену пароля после верного кода; хранится только SHA-256
CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Исходящие SMS. Шлюза пока нет: сообщения пишутся сюда и в лог сервера
CREATE TABLE IF NOT EXISTS sms_outbox (
    id          SERIAL PRIMARY KEY,
    phone       TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
