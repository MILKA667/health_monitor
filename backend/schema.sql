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
