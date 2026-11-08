"""Пороги, оценка измерений и алерты — общая логика для врача, пациента и родственника."""
from decimal import Decimal

from security import short_name
from sms import send_sms

NOSOLOGY_NAMES = {
    'diabetes': 'Сахарный диабет',
    'hypertension': 'Гипертония',
    'asthma': 'Астма',
}

# Какие показатели наблюдаются при нозологии
NOSOLOGY_KIND = {'diabetes': 'glucose', 'hypertension': 'bp', 'asthma': 'pef'}
KIND_METRICS = {'glucose': ('glucose',), 'bp': ('bp_sys', 'bp_dia'), 'pef': ('pef',)}

UNITS = {'glucose': 'ммоль/л', 'bp': 'мм рт. ст.', 'pef': 'л/мин'}
METRIC_NAMES = {'glucose': 'Глюкоза', 'bp_sys': 'АД верхнее', 'bp_dia': 'АД нижнее', 'pef': 'ПСВ, % от лучшего'}

# Пороги по умолчанию (SPEC, раздел «Логика алертов»): crit_low, warn_low, warn_high, crit_high
DEFAULT_THRESHOLDS = {
    'glucose': (Decimal('3.9'), Decimal('4.4'), Decimal('10.0'), Decimal('13.9')),
    'bp_sys': (Decimal(90), Decimal(100), Decimal(140), Decimal(160)),
    'bp_dia': (None, None, Decimal(90), Decimal(100)),
    'pef': (Decimal(50), Decimal(80), None, None),
}
THRESHOLD_FIELDS = ('crit_low', 'warn_low', 'warn_high', 'crit_high')
DEFAULT_SETTINGS = {'escalation_minutes': 15, 'sms_relative': True, 'no_data_alert': True}

NO_DATA_DAYS = 2
LEVEL_ORDER = {'crit': 0, 'warn': 1, 'none': 2, 'ok': 3}


def fmt_number(value, kind_or_metric):
    """Глюкоза — с одним знаком после запятой, остальное — целым."""
    if value is None:
        return None
    value = Decimal(value)
    if kind_or_metric == 'glucose':
        return f'{value:.1f}'.replace('.', ',')
    return str(int(value.quantize(Decimal(1))))


def fmt_signed(delta, metric):
    text = fmt_number(abs(delta), metric)
    return ('+' if delta > 0 else '−') + text


def fmt_value(measurement):
    kind = measurement['kind']
    if kind == 'bp':
        return f"{fmt_number(measurement['value'], 'bp')}/{fmt_number(measurement['value2'], 'bp')}"
    return fmt_number(measurement['value'], kind)


def load_thresholds(cur, patient):
    """Пороги пациента: свои → шаблон нозологии → по умолчанию."""
    result = {metric: dict(zip(THRESHOLD_FIELDS, values)) for metric, values in DEFAULT_THRESHOLDS.items()}
    cur.execute(
        """SELECT * FROM thresholds WHERE nosology = %s OR patient_id = %s
           ORDER BY patient_id NULLS FIRST""",
        (patient['nosology'], patient['user_id']),
    )
    for row in cur.fetchall():
        result[row['metric']] = {field: row[field] for field in THRESHOLD_FIELDS}
    return result


def load_settings(cur, patient):
    cur.execute(
        """SELECT escalation_minutes, sms_relative, no_data_alert FROM alert_settings
           WHERE patient_id = %s OR nosology = %s
           ORDER BY patient_id NULLS LAST LIMIT 1""",
        (patient['user_id'], patient['nosology']),
    )
    return cur.fetchone() or dict(DEFAULT_SETTINGS)


def evaluate_metric(value, limits, metric):
    """→ (level, deviation, rule) для одного показателя; для ПСВ value — проценты от лучшего."""
    crit_low, warn_low, warn_high, crit_high = (limits[field] for field in THRESHOLD_FIELDS)
    checks = [
        ('crit', crit_low, -1, 'ниже критического порога'),
        ('crit', crit_high, 1, 'выше критического порога'),
        ('warn', warn_low, -1, 'ниже цели'),
        ('warn', warn_high, 1, 'выше цели'),
    ]
    for level, limit, direction, rule in checks:
        if limit is None or (value - limit) * direction <= 0:
            continue
        if metric == 'pef':
            percent = fmt_number(value, 'pef')
            return level, f'{percent}% от лучшего', f'{percent}% от лучшего результата, порог {fmt_number(limit, "pef")}%'
        word = 'ниже' if direction < 0 else 'выше'
        limit_text = fmt_number(limit, metric)
        return level, f'{fmt_signed(value - limit, metric)} {word} {limit_text}', f'{rule} {limit_text}'
    return 'ok', None, None


def evaluate(measurement, thresholds, pef_best):
    """Уровень измерения (crit / warn / ok), текст отклонения и правило для алерта."""
    kind = measurement['kind']
    if kind == 'bp':
        results = [
            evaluate_metric(Decimal(measurement['value']), thresholds['bp_sys'], 'bp_sys'),
            evaluate_metric(Decimal(measurement['value2']), thresholds['bp_dia'], 'bp_dia'),
        ]
        return min(results, key=lambda result: LEVEL_ORDER[result[0]])
    if kind == 'pef':
        if not pef_best:
            return 'ok', None, None
        percent = Decimal(measurement['value']) * 100 / pef_best
        return evaluate_metric(percent, thresholds['pef'], 'pef')
    return evaluate_metric(Decimal(measurement['value']), thresholds['glucose'], 'glucose')


def target_text(patient, thresholds):
    kind = NOSOLOGY_KIND[patient['nosology']]
    if kind == 'glucose':
        limits = thresholds['glucose']
        return f"{fmt_number(limits['warn_low'], 'glucose')}–{fmt_number(limits['warn_high'], 'glucose')} ммоль/л"
    if kind == 'bp':
        return f"ниже {fmt_number(thresholds['bp_sys']['warn_high'], 'bp')}/{fmt_number(thresholds['bp_dia']['warn_high'], 'bp')} мм рт. ст."
    percent = thresholds['pef']['warn_low']
    if patient['pef_best'] and percent is not None:
        return f"ПСВ ≥ {fmt_number(percent, 'pef')}% (≥ {fmt_number(patient['pef_best'] * percent / 100, 'pef')} л/мин)"
    return 'ПСВ — лучший результат не указан'


def record_measurement(cur, patient, kind, value, value2=None, source='manual', device_id=None,
                       context=None, wellbeing=(), measured_at=None):
    """Сохраняет измерение и при отклонении создаёт алерт. Возвращает (measurement, alert | None)."""
    cur.execute(
        """INSERT INTO measurements (patient_id, kind, value, value2, source, device_id, context, wellbeing, measured_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
           RETURNING *""",
        (patient['user_id'], kind, value, value2, source, device_id, context, list(wellbeing), measured_at),
    )
    measurement = cur.fetchone()
    level, _, rule = evaluate(measurement, load_thresholds(cur, patient), patient['pef_best'])
    if level == 'ok':
        return measurement, None

    settings = load_settings(cur, patient)
    cur.execute(
        """INSERT INTO alerts (patient_id, measurement_id, level, rule, created_at, escalate_at)
           VALUES (%s, %s, %s, %s, %s, CASE WHEN %s = 'crit' THEN %s + make_interval(mins => %s) END)
           RETURNING *""",
        (patient['user_id'], measurement['id'], level, rule, measurement['measured_at'],
         level, measurement['measured_at'], settings['escalation_minutes']),
    )
    alert = cur.fetchone()

    if level == 'crit' and settings['sms_relative']:
        cur.execute(
            """SELECT c.phone, u.name FROM patient_contacts c JOIN users u ON u.id = c.patient_id
               WHERE c.patient_id = %s AND c.sms_alerts""",
            (patient['user_id'],),
        )
        contact = cur.fetchone()
        if contact:
            send_sms(cur, contact['phone'],
                     f"HealthMonitor: {short_name(contact['name'])} — критичное значение {fmt_value(measurement)} "
                     f"{UNITS[kind]}, врач уже получил уведомление.")
            # Для измерений из прошлого (синхронизация устройства, демо-данные) — минута после замера
            cur.execute(
                "UPDATE alerts SET relative_sms_at = LEAST(now(), created_at + interval '1 minute') WHERE id = %s RETURNING *",
                (alert['id'],),
            )
            alert = cur.fetchone()
    return measurement, alert


def ensure_no_data_alerts(cur, doctor_id):
    """Алерт «нет данных», если у пациента нет измерений NO_DATA_DAYS дней и такой алерт ещё не создан."""
    cur.execute(
        """INSERT INTO alerts (patient_id, level, rule)
           SELECT p.user_id, 'nodata', %s
           FROM patients p
           LEFT JOIN alert_settings s_p ON s_p.patient_id = p.user_id
           LEFT JOIN alert_settings s_n ON s_n.nosology = p.nosology
           LEFT JOIN LATERAL (SELECT max(measured_at) AS last FROM measurements m WHERE m.patient_id = p.user_id) m ON TRUE
           WHERE p.doctor_id = %s
             AND COALESCE(s_p.no_data_alert, s_n.no_data_alert, TRUE)
             AND COALESCE(m.last, p.enrolled_at::timestamptz) < now() - make_interval(days => %s)
             AND NOT EXISTS (
                 SELECT 1 FROM alerts a WHERE a.patient_id = p.user_id AND a.level = 'nodata'
                   AND a.created_at > COALESCE(m.last, p.enrolled_at::timestamptz))""",
        (f'нет измерений более {NO_DATA_DAYS} дней', doctor_id, NO_DATA_DAYS),
    )
