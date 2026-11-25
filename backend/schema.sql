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

-- Решение администратора: какая учётная запись создана и когда
ALTER TABLE applications ADD COLUMN IF NOT EXISTS approved_user_id INTEGER REFERENCES users (id);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

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
-- Удаление учётной записи: вход запрещён, персональные контакты очищаются, медданные остаются
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- У удалённой записи контактов может не быть
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users ADD CONSTRAINT users_check CHECK (phone IS NOT NULL OR email IS NOT NULL OR deleted_at IS NOT NULL);

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

-- Назначения врача: препарат и схема. Схему меняет врач, пациент только включает напоминания.
CREATE TABLE IF NOT EXISTS medications (
    id             SERIAL PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients (user_id),
    name           TEXT NOT NULL,
    schedule       TEXT NOT NULL,
    prescribed_at  DATE NOT NULL DEFAULT CURRENT_DATE,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Приёмы внутри схемы: время и что именно принять («1 таблетка после завтрака»)
CREATE TABLE IF NOT EXISTS medication_slots (
    id             SERIAL PRIMARY KEY,
    medication_id  INTEGER NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
    time_of_day    TIME NOT NULL,
    dose           TEXT NOT NULL DEFAULT ''
);

-- Напоминание можно выключить отдельно для каждого времени приёма
ALTER TABLE medication_slots ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Отметки о приёме. Удалять и менять их нельзя: приверженность — часть медкарты.
CREATE TABLE IF NOT EXISTS medication_intakes (
    slot_id   INTEGER NOT NULL REFERENCES medication_slots (id) ON DELETE CASCADE,
    taken_on  DATE NOT NULL,
    taken_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (slot_id, taken_on)
);

-- Переписка пациента с врачом. Родственник переписку не видит.
CREATE TABLE IF NOT EXISTS messages (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients (user_id),
    sender_id   INTEGER NOT NULL REFERENCES users (id),
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_patient_time ON messages (patient_id, created_at);

-- Сформированные отчёты врача: параметры сохраняются, печатная версия собирается по запросу
CREATE TABLE IF NOT EXISTS reports (
    id          SERIAL PRIMARY KEY,
    doctor_id   INTEGER NOT NULL REFERENCES users (id),
    kind        TEXT NOT NULL CHECK (kind IN ('patient', 'group', 'response')),
    patient_id  INTEGER REFERENCES patients (user_id),
    nosology    TEXT CHECK (nosology IN ('all', 'diabetes', 'hypertension', 'asthma')),
    days        INTEGER NOT NULL,
    sections    TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_doctor_time ON reports (doctor_id, created_at DESC);

-- Напоминания о замерах, которые настраивает пациент
CREATE TABLE IF NOT EXISTS measurement_reminders (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients (user_id),
    kind        TEXT NOT NULL CHECK (kind IN ('glucose', 'bp', 'pef')),
    time_of_day TIME NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Каналы напоминаний пациента. Строки может не быть — тогда оба канала включены.
CREATE TABLE IF NOT EXISTS patient_settings (
    patient_id    INTEGER PRIMARY KEY REFERENCES patients (user_id),
    push_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Родственник получает доступ к показателям только по ссылке от пациента
CREATE TABLE IF NOT EXISTS relative_links (
    relative_id   INTEGER PRIMARY KEY REFERENCES users (id),
    patient_id    INTEGER NOT NULL REFERENCES patients (user_id),
    push_enabled  BOOLEAN NOT NULL DEFAULT TRUE
);
