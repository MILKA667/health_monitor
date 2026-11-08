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

-- Лучший результат ПСВ пациента: пороги ПСВ задаются в процентах от него
ALTER TABLE patients ADD COLUMN IF NOT EXISTS pef_best INTEGER;

CREATE TABLE IF NOT EXISTS devices (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients (user_id),
    kind        TEXT NOT NULL CHECK (kind IN ('glucometer', 'tonometer', 'peakflow')),
    model       TEXT NOT NULL,
    connected   BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync   TIMESTAMPTZ
);

-- Измерения не удаляются и не меняются: см. триггер ниже.
-- Давление — value (верхнее) и value2 (нижнее), остальные — только value.
CREATE TABLE IF NOT EXISTS measurements (
    id           SERIAL PRIMARY KEY,
    patient_id   INTEGER NOT NULL REFERENCES patients (user_id),
    kind         TEXT NOT NULL CHECK (kind IN ('glucose', 'bp', 'pef')),
    value        NUMERIC(6, 1) NOT NULL,
    value2       NUMERIC(6, 1),
    source       TEXT NOT NULL CHECK (source IN ('device', 'manual')),
    device_id    INTEGER REFERENCES devices (id),
    context      TEXT,
    wellbeing    TEXT[] NOT NULL DEFAULT '{}',
    measured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'bp') = (value2 IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS measurements_patient_time ON measurements (patient_id, measured_at DESC);

CREATE OR REPLACE FUNCTION forbid_measurement_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Измерения нельзя изменять или удалять' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS measurements_immutable ON measurements;
CREATE TRIGGER measurements_immutable BEFORE UPDATE OR DELETE ON measurements
    FOR EACH ROW EXECUTE FUNCTION forbid_measurement_change();

-- Пороги: на конкретного пациента или шаблоном на нозологию. Пустое значение — порог не используется.
-- Для ПСВ значения — проценты от лучшего результата пациента.
CREATE TABLE IF NOT EXISTS thresholds (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER REFERENCES patients (user_id),
    nosology    TEXT CHECK (nosology IN ('diabetes', 'hypertension', 'asthma')),
    metric      TEXT NOT NULL CHECK (metric IN ('glucose', 'bp_sys', 'bp_dia', 'pef')),
    crit_low    NUMERIC(6, 1),
    warn_low    NUMERIC(6, 1),
    warn_high   NUMERIC(6, 1),
    crit_high   NUMERIC(6, 1),
    CHECK ((patient_id IS NULL) <> (nosology IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS thresholds_patient_metric ON thresholds (patient_id, metric) WHERE patient_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS thresholds_nosology_metric ON thresholds (nosology, metric) WHERE nosology IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_settings (
    id                  SERIAL PRIMARY KEY,
    patient_id          INTEGER UNIQUE REFERENCES patients (user_id),
    nosology            TEXT UNIQUE CHECK (nosology IN ('diabetes', 'hypertension', 'asthma')),
    escalation_minutes  INTEGER NOT NULL DEFAULT 15 CHECK (escalation_minutes IN (10, 15, 20)),
    sms_relative        BOOLEAN NOT NULL DEFAULT TRUE,
    no_data_alert       BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK ((patient_id IS NULL) <> (nosology IS NULL))
);

-- Алерт открыт, пока не принят. Критичный без реакции до escalate_at считается эскалированным дежурному.
CREATE TABLE IF NOT EXISTS alerts (
    id                  SERIAL PRIMARY KEY,
    patient_id          INTEGER NOT NULL REFERENCES patients (user_id),
    measurement_id      INTEGER REFERENCES measurements (id),
    level               TEXT NOT NULL CHECK (level IN ('crit', 'warn', 'nodata')),
    rule                TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    escalate_at         TIMESTAMPTZ,
    relative_sms_at     TIMESTAMPTZ,
    accepted_at         TIMESTAMPTZ,
    accepted_by         INTEGER REFERENCES users (id),
    comment             TEXT
);
CREATE INDEX IF NOT EXISTS alerts_patient_time ON alerts (patient_id, created_at DESC);

-- Дежурный врач получает критичные алерты, на которые не отреагировали вовремя
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS on_duty BOOLEAN NOT NULL DEFAULT FALSE;
