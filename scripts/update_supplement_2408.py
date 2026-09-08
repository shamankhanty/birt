#!/usr/bin/env python3
"""Дополняет обновление 24.08: МАХ и диагностические ТВСП."""
import json
import re
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

SITE = Path(__file__).resolve().parents[1]
UP = Path('/workspace/scratch/8e713f374d53/upload')


def text(value):
    return '' if value is None else str(value).strip()


def norm(value):
    value = text(value).lower().replace('ё', 'е')
    value = re.sub(r'^(?:филиал\s+)?(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во|ао|ооо|чуз)(?:\s+рт)?\s*', '', value)
    value = re.sub(r'["«»]', '', value)
    return re.sub(r'[^а-яa-z0-9№]+', ' ', value).strip()


def one(pattern):
    files = sorted(UP.glob(pattern))
    if len(files) != 1:
        raise ValueError(f'{pattern}: найдено {len(files)} файлов')
    return files[0]


def load(name):
    return json.loads((SITE / 'app' / name).read_text(encoding='utf-8'))


def dump(name, data):
    (SITE / 'app' / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def dataset(old, name, date, period, rows):
    previous = {norm(row['name']): row.get('fact') for row in old.get('rows', [])}
    for row in rows:
        prev = previous.get(norm(row['name']))
        row['previous'] = prev
        row['trend'] = row['fact'] - prev if prev is not None else None
    return {'name': name, 'plan': 10000, 'unit': '', 'date': date, 'period': period,
            'mode': 'count', 'direction': 'higher', 'rows': rows}


operational = load('operational-mo.json')
max_ws = load_workbook(one('ТМК_МАХ*24.08.26*.xlsx'), read_only=True, data_only=True)['Лист1']
tmk_rows, eln_rows = [], []
for row in max_ws.iter_rows(min_row=3, values_only=True):
    name = text(row[0])
    if not name or name.lower().startswith('итого'):
        continue
    tmk, eln = int(row[3] or 0), int(row[4] or 0)
    tmk_rows.append({'name': name, 'fact': tmk, 'count': tmk})
    eln_rows.append({'name': name, 'fact': eln, 'count': eln})
if not tmk_rows:
    raise ValueError('МАХ: строки МО не найдены')
operational['tmkMaxCount'] = dataset(operational.get('tmkMaxCount', {}), 'Количество проведённых ТМК посредством МАХ', '24.08.2026', '01.08–24.08.2026', tmk_rows)
operational['elnMaxCount'] = dataset(operational.get('elnMaxCount', {}), 'Количество ЛВН, закрытых после ТМК посредством МАХ', '24.08.2026', '01.08–24.08.2026', eln_rows)

unit_data = load('unit-data.json')
mo = load('mo-data.json')
details = load('mo-details.json')
detail_oids = load('mo-detail-oids.json')
diag = one('Доля_ТВСП*диагностических*24.08.26*.xlsx')
wb = load_workbook(diag, read_only=True, data_only=True)
summary = wb['Сводный']
summary_row = next(row for row in summary.iter_rows(values_only=True) if text(row[1]) == 'Республика Татарстан')
expected_plan, expected_fact = int(summary_row[2]), int(summary_row[3])
ws = wb['Факт передачи']
seen = {}
for row in ws.iter_rows(min_row=7, values_only=True):
    if text(row[1]) != 'Республика Татарстан' or not text(row[2]):
        continue
    key = (text(row[3]), text(row[4]))
    seen[key] = {'mo': text(row[2]), 'moOid': text(row[3]), 'unit': text(row[5]) or f'Здание {text(row[4])}',
                 'unitOid': text(row[4]), 'buildingIds': text(row[4]),
                 'registered': text(row[6]).lower() == 'да', 'count': 0}
rows = list(seen.values())
if (len(rows), sum(item['registered'] for item in rows)) != (expected_plan, expected_fact):
    raise ValueError(f'Диагностические ТВСП: детализация не сошлась со сводным листом')
unit_data['tvspDiagnostic'] = {'name': 'ТВСП, передающие протоколы диагностических исследований',
    'entity': 'объект контроля с ТВСП', 'plan': expected_plan, 'fact': expected_fact,
    'date': '24.08.2026', 'rows': rows}

old = {text(row.get('oid')): row.get('fact') for row in mo.get('tvspDiagnostic', {}).get('rows', []) if text(row.get('oid'))}
grouped = defaultdict(lambda: {'name': '', 'oid': '', 'volume': 0, 'registered': 0})
for item in rows:
    key = item['moOid'] or norm(item['mo'])
    grouped[key]['name'], grouped[key]['oid'] = item['mo'], item['moOid']
    grouped[key]['volume'] += 1
    grouped[key]['registered'] += int(item['registered'])
metric_rows, metric_details, metric_oid_details = [], {}, {}
for item in grouped.values():
    fact = item['registered'] / item['volume'] * 100 if item['volume'] else 0
    previous = old.get(item['oid'])
    metric_rows.append({'name': item['name'], 'oid': item['oid'], 'fact': fact,
                        'count': item['registered'], 'previous': previous,
                        'trend': fact - previous if previous is not None else None})
    detail = {'volume': item['volume'], 'registered': item['registered']}
    metric_details[item['name']] = detail
    if item['oid']:
        metric_oid_details[item['oid']] = detail
mo['tvspDiagnostic'] = {'name': unit_data['tvspDiagnostic']['name'], 'plan': 100, 'unit': '%',
    'date': '23.08.2026', 'period': '01.01–23.08.2026', 'rows': metric_rows}
details['tvspDiagnostic'], detail_oids['tvspDiagnostic'] = metric_details, metric_oid_details

dump('operational-mo.json', operational)
dump('unit-data.json', unit_data)
dump('mo-data.json', mo)
dump('mo-details.json', details)
dump('mo-detail-oids.json', detail_oids)
print(json.dumps({'tmkMax': sum(r['fact'] for r in tmk_rows), 'elnMax': sum(r['fact'] for r in eln_rows),
                  'diagnostic': [expected_fact, expected_plan]}, ensure_ascii=False, indent=2))
