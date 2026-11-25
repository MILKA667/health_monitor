from decimal import Decimal

import psycopg2
import pytest

from db import db_cursor
from monitoring import DEFAULT_THRESHOLDS, THRESHOLD_FIELDS, evaluate, fmt_value

THRESHOLDS = {metric: dict(zip(THRESHOLD_FIELDS, values)) for metric, values in DEFAULT_THRESHOLDS.items()}


def glucose(value):
    return {'kind': 'glucose', 'value': Decimal(str(value)), 'value2': None}


def bp(sys, dia):
    return {'kind': 'bp', 'value': Decimal(sys), 'value2': Decimal(dia)}


@pytest.mark.parametrize('value, expected', [
    (2.9, ('crit', '−1,0 ниже 3,9', 'ниже критического порога 3,9')),
    (4.1, ('warn', '−0,3 ниже 4,4', 'ниже цели 4,4')),
    (6.5, ('ok', None, None)),
    (10.0, ('ok', None, None)),
    (11.4, ('warn', '+1,4 выше 10,0', 'выше цели 10,0')),
    (15.0, ('crit', '+1,1 выше 13,9', 'выше критического порога 13,9')),
])
def test_glucose_levels(value, expected):
    assert evaluate(glucose(value), THRESHOLDS, None) == expected


def test_blood_pressure_takes_worst_of_two():
    assert evaluate(bp(182, 108), THRESHOLDS, None)[:2] == ('crit', '+22 выше 160')
    assert evaluate(bp(152, 94), THRESHOLDS, None)[:2] == ('warn', '+12 выше 140')
    # Верхнее в норме, нижнее за критическим порогом
    assert evaluate(bp(130, 105), THRESHOLDS, None)[:2] == ('crit', '+5 выше 100')
    assert evaluate(bp(128, 82), THRESHOLDS, None)[0] == 'ok'


def test_peak_flow_percent_of_best():
    pef = {'kind': 'pef', 'value': Decimal(290), 'value2': None}
    assert evaluate(pef, THRESHOLDS, 468) == ('warn', '62% от лучшего', '62% от лучшего результата, порог 80%')
    assert evaluate({**pef, 'value': Decimal(200)}, THRESHOLDS, 468)[0] == 'crit'
    # Без лучшего результата оценить нельзя
    assert evaluate(pef, THRESHOLDS, None)[0] == 'ok'


def test_format_value():
    assert fmt_value(glucose(6)) == '6,0'
    assert fmt_value(bp(120, 80)) == '120/80'


def test_patient_threshold_overrides_template(app, demo):
    with db_cursor() as cur:
        cur.execute("SELECT user_id FROM patients p JOIN users u ON u.id = p.user_id WHERE u.phone = '79000000106'")
        patient_id = cur.fetchone()['user_id']
        cur.execute(
            """INSERT INTO thresholds (nosology, metric, crit_low, warn_low, warn_high, crit_high)
               VALUES ('diabetes', 'glucose', 3.5, 4.0, 12.0, 15.0)""")
        cur.execute(
            """INSERT INTO thresholds (patient_id, metric, crit_low, warn_low, warn_high, crit_high)
               VALUES (%s, 'glucose', 3.9, 4.4, 11.0, 13.9)""", (patient_id,))
        from monitoring import load_thresholds
        cur.execute('SELECT * FROM patients WHERE user_id = %s', (patient_id,))
        assert load_thresholds(cur, cur.fetchone())['glucose']['warn_high'] == Decimal('11.0')
        cur.execute("SELECT * FROM patients p JOIN users u ON u.id = p.user_id WHERE u.phone = '79000000102'")
        assert load_thresholds(cur, cur.fetchone())['glucose']['warn_high'] == Decimal('12.0')


def test_measurements_cannot_be_deleted_or_changed(demo):
    for statement in ('DELETE FROM measurements', 'UPDATE measurements SET value = 5'):
        with pytest.raises(psycopg2.Error):
            with db_cursor() as cur:
                cur.execute(statement)
