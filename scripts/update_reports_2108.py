#!/usr/bin/env python3
"""Обновление регионального контура по архиву «Отчеты по письму».

Федеральный раздел и показатели МАХ намеренно не изменяются.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from openpyxl import load_workbook
import xlrd

SITE = Path(__file__).resolve().parents[1]
ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/workspace/scratch/8e713f374d53/upload')


def text(value):
    return '' if value is None else str(value).strip()


def norm(value):
    value = text(value).lower().replace('ё', 'е')
    value = re.sub(r'^(?:филиал\s+)?(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во|ао|ооо|чуз)(?:\s+рт)?\s*', '', value)
    value = re.sub(r'["«»]', '', value)
    value = re.sub(r'\s*\([^)]*\)\s*$', '', value)
    for old, new in {
        'городская клиническая больница': 'гкб',
        'городская детская клиническая больница': 'дгкб',
        'городская детская больница': 'дгб',
        'городская детская поликлиника': 'дгп',
        'детская городская поликлиника': 'дгп',
        'городская больница': 'гб',
        'городская поликлиника': 'гп',
        'центральная районная больница': 'црб',
    }.items():
        value = value.replace(old, new)
    value = value.replace('г. казани', 'казань').replace('г. казань', 'казань')
    value = value.replace('г. наб.челны', 'наб челны').replace('г. набережные челны', 'наб челны')
    value = re.sub(r'\s*№\s*', '№', value)
    return re.sub(r'[^а-яa-z0-9№]+', ' ', value).strip()


def one(pattern):
    files = sorted(ROOT.rglob(pattern))
    if not files:
        raise FileNotFoundError(pattern)
    return files[-1]


def load(name):
    return json.loads((SITE / 'app' / name).read_text(encoding='utf-8'))


def dump(name, value):
    (SITE / 'app' / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def private(name):
    return bool(re.match(r'^(?:ООО|АО|ЧУЗ)\b', text(name), re.I))


def dataset(old, name, plan, date, period, rows, note=None):
    if old.get('date') == date:
        previous = {norm(row['name']): row.get('previous') for row in old.get('rows', [])}
    else:
        previous = {norm(row['name']): row.get('fact') for row in old.get('rows', [])}
    for row in rows:
        prev = previous.get(norm(row['name']))
        row['previous'] = prev
        row['trend'] = row['fact'] - prev if prev is not None else None
    result = {'name': name, 'plan': plan, 'unit': '%', 'date': date, 'period': period, 'rows': rows}
    if note:
        result['note'] = note
    return result


def ratio_sheet(path, sheet, name_col, oid_col, den_col, num_cols):
    ws = load_workbook(path, read_only=True, data_only=True)[sheet]
    rows, details, oid_details = [], {}, {}
    for row in ws.iter_rows(values_only=True):
        name = text(row[name_col]) if len(row) > name_col else ''
        oid = text(row[oid_col]) if len(row) > oid_col else ''
        denominator = row[den_col] if len(row) > den_col else None
        if not name or name.lower().startswith('итого') or not isinstance(denominator, (int, float)):
            continue
        if oid and not re.fullmatch(r'\d+(?:\.\d+)+', oid):
            continue
        numerator = sum((row[index] or 0) for index in num_cols if len(row) > index and isinstance(row[index], (int, float)))
        fact = numerator / denominator * 100 if denominator else 0
        rows.append({'name': name, 'oid': oid, 'fact': fact, 'count': int(numerator)})
        detail = {'volume': int(denominator), 'registered': int(numerator)}
        details[norm(name)] = detail
        if oid:
            oid_details[oid] = detail
    if not rows:
        raise ValueError(f'Нет строк данных: {path.name}')
    return rows, details, oid_details


def oids(value):
    return re.findall(r'1\.2\.643(?:\.\d+)+', text(value))


def unit_sp(path, name, entity, expected):
    ws = load_workbook(path, read_only=True, data_only=True)['Детализация по СП']
    rows = []
    for row in ws.iter_rows(min_row=7, values_only=True):
        if text(row[0]) != 'Республика Татарстан' or not text(row[1]):
            continue
        planned, passed, failed = oids(row[4]), oids(row[5]), oids(row[6])
        if not planned:
            continue
        rows.append({
            'mo': text(row[1]), 'moOid': text(row[2]), 'unit': f'Здание {text(row[3])}',
            'unitOid': ', '.join(planned), 'buildingIds': text(row[3]),
            'registered': bool(passed), 'partial': bool(passed and failed), 'count': 0,
            'plannedSubunits': len(set(planned)), 'registeredSubunits': len(set(planned) & set(passed)),
        })
    fact = sum(item['registered'] for item in rows)
    if (len(rows), fact) != expected:
        raise ValueError((path.name, len(rows), fact, expected))
    return {'name': name, 'entity': entity, 'plan': len(rows), 'fact': fact, 'date': '24.08.2026', 'rows': rows}


def unit_buildings(path, name, entity, expected):
    ws = load_workbook(path, read_only=True, data_only=True)['Факт передачи']
    seen = {}
    for row in ws.iter_rows(min_row=7, values_only=True):
        if text(row[1]) != 'Республика Татарстан' or not text(row[2]):
            continue
        key = (text(row[3]), text(row[4]))
        seen[key] = {
            'mo': text(row[2]), 'moOid': text(row[3]), 'unit': text(row[5]) or f'Здание {text(row[4])}',
            'unitOid': text(row[4]), 'buildingIds': text(row[4]),
            'registered': text(row[6]).lower() == 'да', 'count': 0,
        }
    rows = list(seen.values())
    fact = sum(item['registered'] for item in rows)
    if (len(rows), fact) != expected:
        raise ValueError((path.name, len(rows), fact, expected))
    return {'name': name, 'entity': entity, 'plan': len(rows), 'fact': fact, 'date': '24.08.2026', 'rows': rows}


mo = load('mo-data.json')
details = load('mo-details.json')
detail_oids = load('mo-detail-oids.json')
status = load('organization-status.json')

# ЕПГУ: частные организации не входят в республиканский управленческий срез.
egpu_path = one('*ПР_2*24.08.2026*.xlsx')
ws = load_workbook(egpu_path, read_only=True, data_only=True).active
egpu_rows, two_rows, egpu_details, two_details, egpu_oids, two_oids = [], [], {}, {}, {}, {}
for row in ws.iter_rows(min_row=4, values_only=True):
    name, oid, submitted = text(row[2]), text(row[3]), row[4]
    if not name or private(name) or not isinstance(submitted, (int, float)):
        continue
    final, two = int(row[5] or 0), int(row[6] or 0)
    egpu_rows.append({'name': name, 'oid': oid, 'fact': final / submitted * 100 if submitted else 0, 'count': final})
    two_rows.append({'name': name, 'oid': oid, 'fact': two / submitted * 100 if submitted else 0, 'count': two})
    egpu_details[norm(name)] = {'volume': int(submitted), 'registered': final}
    two_details[norm(name)] = {'volume': int(submitted), 'registered': two}
    if oid:
        egpu_oids[oid] = egpu_details[norm(name)]
        two_oids[oid] = two_details[norm(name)]
mo['egpu'] = dataset(mo.get('egpu', {}), 'Доля заявлений о прикреплении на ЕПГУ', 100, '23.08.2026', '01.01–23.08.2026', egpu_rows, 'Частные МО исключены из республиканского итога и управленческих списков.')
mo['egpu2days'] = dataset(mo.get('egpu2days', {}), 'Доля заявлений о прикреплении на ЕПГУ, рассмотренных за 2 рабочих дня', 90, '23.08.2026', '01.01–23.08.2026', two_rows, 'Контрольный срок — 2 рабочих дня. Частные МО исключены.')
details['egpu'], details['egpu2days'] = egpu_details, two_details
detail_oids['egpu'], detail_oids['egpu2days'] = egpu_oids, two_oids

# СЭМД №228.
rows, det, oid_det = ratio_sheet(one('*профилактического*24.08.26*.xlsx'), 'Лист1', 0, 1, 2, [3])
mo['semd228'] = dataset(mo.get('semd228', {}), 'Доля СЭМД «Результаты профилактического медицинского осмотра/диспансеризации» (СЭМД №228) относительно количества обращений', 95, '23.08.2026', '01.01–23.08.2026', rows)
details['semd228'], detail_oids['semd228'] = det, oid_det

# Свидетельства о рождении и смерти.
def registry_metric(metric, path, title):
    source = load_workbook(path, read_only=True, data_only=True).active
    aggregated = defaultdict(lambda: [0, 0, 0, 0, 0])
    heading = ' '.join(text(cell) for row in source.iter_rows(min_row=1, max_row=4, values_only=True) for cell in row if cell)
    period_match = re.search(r'\d{2}\.\d{2}\.\d{2,4}\s*[-–]\s*(\d{2}\.\d{2}\.\d{2,4})', heading)
    if not period_match:
        raise ValueError(f'Не найдена дата окончания периода в заголовке: {path.name}')
    raw_end = period_match.group(1)
    report_end = datetime.strptime(raw_end, '%d.%m.%y' if len(raw_end.split('.')[-1]) == 2 else '%d.%m.%Y').date()
    overdue_through = report_end - timedelta(days=3)
    grace_start = overdue_through + timedelta(days=1)
    for row in source.iter_rows(values_only=True):
        name = text(row[0])
        certificate_number = text(row[1]) if len(row) > 1 else ''
        state = text(row[3]).lower() if len(row) > 3 else ''
        issued = row[2] if len(row) > 2 else None
        # В знаменатель входит каждое фактически выданное свидетельство.
        # «Создан», «Отправлен», «Ошибка» и пустой статус означают, что
        # регистрация ещё не завершена. В числителе — только зарегистрированные.
        if not name or not certificate_number or name.startswith(('Где в столбце', 'Учреждение')):
            continue
        issued_date = issued.date() if isinstance(issued, datetime) else issued
        if not issued_date or issued_date > report_end:
            continue
        is_registered = state == 'зарегистрирован'
        aggregated[name][0] += 1
        aggregated[name][1] += int(is_registered)
        is_overdue = issued_date <= overdue_through
        aggregated[name][2] += int(is_overdue)
        aggregated[name][3] += int(is_overdue and is_registered)
        aggregated[name][4] += int(not is_registered and not is_overdue)
    result_rows, metric_details = [], {}
    for name, (volume, registered, overdue_volume, overdue_registered, grace_pending) in aggregated.items():
        result_rows.append({'name': name, 'fact': registered / volume * 100 if volume else 0, 'count': registered,
                            'attentionFact': overdue_registered / overdue_volume * 100 if overdue_volume else 100,
                            'overdueVolume': overdue_volume, 'overdueRegistered': overdue_registered,
                            'gracePending': grace_pending})
        metric_details[norm(name)] = {'volume': volume, 'registered': registered,
                                      'overdueVolume': overdue_volume, 'overdueRegistered': overdue_registered,
                                      'gracePending': grace_pending}
    report_end_text = report_end.strftime('%d.%m.%Y')
    grace_text = f'{grace_start.strftime("%d.%m")}–{report_end.strftime("%d.%m.%Y")}'
    mo[metric] = dataset(mo.get(metric, {}), title, 99, report_end_text, f'01.01–{report_end_text}', result_rows,
                         f'Официальный факт рассчитан по всем свидетельствам периода. В управленческий список должников не включены незавершённые свидетельства, выданные {grace_text}: действует 3-дневный срок регистрации.')
    details[metric] = metric_details

registry_metric('birth', one('*рождении*24.08.26*.xlsx'), 'МСР')
registry_metric('death', one('*смерти*24.08.26*.xlsx'), 'МСС')

# ТВСП/КДЛ/ССМП и протокол ТМК: текущая детализация по объектам контроля.
unit_data = load('unit-data.json')
unit_sources = {
    'tvspAmbulatory': (one('*Эпик по закон*24.08.26*.xlsx'), 'Амбулаторные ТВСП, передающие эпикриз/талон и/или протокол консультации', 'объект контроля с ТВСП', (461, 459)),
    'tvspStationary': (one('*Эпикриз_в_стационаре*24.08.26*.xlsx'), 'ТВСП, передающие выписные эпикризы', 'объект контроля с ТВСП', (276, 273)),
    'tvspLaboratory': (one('*Протокол лабораторного*24.08.26*.xlsx'), 'КДЛ, передающие протоколы лабораторных исследований', 'объект контроля КДЛ', (127, 123)),
}
for metric, (path, name, entity, expected) in unit_sources.items():
    unit_data[metric] = unit_sp(path, name, entity, expected)
    old_rows = {text(row.get('oid')): row.get('fact') for row in mo.get(metric, {}).get('rows', []) if text(row.get('oid'))}
    grouped = defaultdict(lambda: {'name': '', 'oid': '', 'volume': 0, 'registered': 0})
    for item in unit_data[metric]['rows']:
        key = item['moOid'] or norm(item['mo'])
        grouped[key]['name'], grouped[key]['oid'] = item['mo'], item['moOid']
        grouped[key]['volume'] += 1
        grouped[key]['registered'] += int(item['registered'])
    metric_rows, metric_details, metric_oid_details = [], {}, {}
    for item in grouped.values():
        fact = item['registered'] / item['volume'] * 100 if item['volume'] else 0
        previous = old_rows.get(item['oid'])
        metric_rows.append({'name': item['name'], 'oid': item['oid'], 'fact': fact, 'count': item['registered'], 'previous': previous, 'trend': fact - previous if previous is not None else None})
        detail = {'volume': item['volume'], 'registered': item['registered']}
        metric_details[item['name']] = detail
        if item['oid']:
            metric_oid_details[item['oid']] = detail
    mo[metric] = {'name': name, 'plan': 100, 'unit': '%', 'date': '23.08.2026', 'period': '01.01–23.08.2026', 'rows': metric_rows}
    details[metric], detail_oids[metric] = metric_details, metric_oid_details

unit_data['smpFederal'] = unit_buildings(
    one('*Отчет_СМП_ТВСП*24.08.26*.xlsx'),
    'Станции и подстанции СМП, передающие карты вызова',
    'станция / подстанция СМП',
    (69, 67),
)
old_rows = {text(row.get('oid')): row.get('fact') for row in mo.get('smpFederal', {}).get('rows', []) if text(row.get('oid'))}
grouped = defaultdict(lambda: {'name': '', 'oid': '', 'volume': 0, 'registered': 0})
for item in unit_data['smpFederal']['rows']:
    key = item['moOid'] or norm(item['mo'])
    grouped[key]['name'], grouped[key]['oid'] = item['mo'], item['moOid']
    grouped[key]['volume'] += 1
    grouped[key]['registered'] += int(item['registered'])
metric_rows, metric_details, metric_oid_details = [], {}, {}
for item in grouped.values():
    fact = item['registered'] / item['volume'] * 100 if item['volume'] else 0
    previous = old_rows.get(item['oid'])
    metric_rows.append({'name': item['name'], 'oid': item['oid'], 'fact': fact, 'count': item['registered'], 'previous': previous, 'trend': fact - previous if previous is not None else None})
    detail = {'volume': item['volume'], 'registered': item['registered']}
    metric_details[item['name']] = detail
    if item['oid']:
        metric_oid_details[item['oid']] = detail
mo['smpFederal'] = {'name': unit_data['smpFederal']['name'], 'plan': 100, 'unit': '%', 'date': '23.08.2026', 'period': '01.01–23.08.2026', 'rows': metric_rows}
details['smpFederal'], detail_oids['smpFederal'] = metric_details, metric_oid_details

# Карты вызова СМП из АСУ ССМП отсутствуют в поставке 24.08 — сохраняем
# последний подтвержденный срез, не меняя его дату.

# Все виды СЭМД и детализация ошибок.
remd_path = one('*Медкнижки*.xlsx')
wb = load_workbook(remd_path, read_only=True, data_only=True)
header_wb = load_workbook(remd_path, read_only=True, data_only=False)
summary = wb['Отчет РЭМД']
name_row = next(header_wb['Отчет РЭМД'].iter_rows(min_row=5, max_row=5, values_only=True))
format_row = next(header_wb['Отчет РЭМД'].iter_rows(min_row=6, max_row=6, values_only=True))
values = next(summary.iter_rows(min_row=8, max_row=8, values_only=True))
combined = defaultdict(lambda: {'count': 0, 'formats': []})
last_name = ''
for index in range(4, summary.max_column + 1):
    if text(name_row[index - 1]):
        last_name = text(name_row[index - 1])
    if not last_name:
        continue
    count = int(values[index - 1]) if isinstance(values[index - 1], (int, float)) else 0
    combined[last_name]['count'] += count
    fmt = text(format_row[index - 1])
    if fmt and fmt not in combined[last_name]['formats']:
        combined[last_name]['formats'].append(fmt)
semd_summary = {
    'period': '01.01.2026–23.08.2026', 'formed': '24.08.2026',
    'total': int(values[2]), 'registeredTypes': int(values[1]),
    'items': [{'name': name, 'count': item['count'], 'format': ' / '.join(item['formats']) or '—'} for name, item in combined.items()],
}
if sum(item['count'] for item in semd_summary['items']) != semd_summary['total']:
    raise ValueError('Сумма видов СЭМД не равна итогу')

error_ws = load_workbook(one('*Отказы*24.08.26*.xlsx'), read_only=True, data_only=True).active
categories = Counter()
for row in error_ws.iter_rows(min_row=6, values_only=True):
    description, count = text(row[8]), row[9]
    if description and isinstance(count, (int, float)):
        categories[description] += int(count)
error_categories = {
    'total': sum(categories.values()), 'period': '01.01–23.08.2026',
    'share': 15, 'shareDate': '19.08.2026', 'shareSource': 'Федеральный мониторинг РЭМД',
    'items': [{'name': name, 'count': count} for name, count in categories.most_common()],
}

# ЭЛМК: сохраняем утверждённый перечень 74 МО, факт обновляем по OID.
mo_ws = wb['Отчет РЭМД по МО']
header_ws = header_wb['Отчет РЭМД по МО']
mo_name_row = next(header_ws.iter_rows(min_row=5, max_row=5, values_only=True))
last_name, elmk_columns = '', []
for index in range(6, mo_ws.max_column + 1):
    if text(mo_name_row[index - 1]):
        last_name = text(mo_name_row[index - 1])
    low = last_name.lower()
    if ('подсистем' in low and 'элмк' in low) or ('медицинское заключение' in low and 'осмотр' in low):
        elmk_columns.append(index)
if not elmk_columns:
    raise ValueError('Не найдены столбцы ЭЛМК')
elmk_by_oid = defaultdict(int)
for row in mo_ws.iter_rows(min_row=8, values_only=True):
    oid = text(row[2])
    if oid:
        elmk_by_oid[oid] += sum(int(row[index - 1] or 0) for index in elmk_columns if isinstance(row[index - 1], (int, float)))
for item in status['elmk']['rows']:
    previous = item.get('fact')
    count = elmk_by_oid.get(text(item.get('oid')), 0)
    item.update({'count': count, 'previous': previous, 'fact': 100 if count > 0 else 0})
    item['trend'] = item['fact'] - previous if previous is not None else None
status['elmk']['date'] = '23.08.2026'
status['elmk']['period'] = '01.01–23.08.2026'
elmk_fact = sum(item['fact'] > 0 for item in status['elmk']['rows'])
status['elmk']['note'] = f'Плановый перечень — 74 МО. На 23.08.2026 передача СЭМД подтверждена у {elmk_fact} МО.'
if len(status['elmk']['rows']) != 74 or any(not text(item.get('oid')) for item in status['elmk']['rows']):
    raise ValueError('Нарушен утверждённый перечень ЭЛМК')

# Протокол ТМК: факт обновляется по OID внутри утверждённого перечня 40 МО.
tmk_ws = load_workbook(one('*Отчет_ТМК_РЭМД*24.08.26*.xlsx'), read_only=True, data_only=True)['Детализированный отчет']
tmk_by_oid = {}
for row in tmk_ws.iter_rows(min_row=7, values_only=True):
    if text(row[1]) == 'Республика Татарстан' and text(row[3]):
        tmk_by_oid[text(row[3])] = int(row[4] or 0)
for item in status['tmkRemd']['rows']:
    previous = item.get('fact')
    count = tmk_by_oid.get(text(item.get('oid')), 0)
    item.update({'count': count, 'previous': previous, 'fact': 100 if count > 0 else 0})
    item['trend'] = item['fact'] - previous if previous is not None else None
status['tmkRemd']['date'] = '23.08.2026'
status['tmkRemd']['period'] = '01.01–23.08.2026'
status['tmkRemd']['note'] = 'План — 100%. В утверждённом перечне 40 МО: 39 зарегистрировали СЭМД, одна МО имеет нулевой результат.'

dump('mo-data.json', mo)
dump('mo-details.json', details)
dump('mo-detail-oids.json', detail_oids)
dump('unit-data.json', unit_data)
dump('semd-summary.json', semd_summary)
dump('error-categories.json', error_categories)
dump('organization-status.json', status)
print(json.dumps({
    'egpu': [sum(item['count'] for item in egpu_rows), sum(item['volume'] for item in egpu_details.values())],
    'egpu_2days': sum(item['count'] for item in two_rows),
    'semd228': [sum(item['count'] for item in rows), sum(item['volume'] for item in det.values())],
    'semd_total': semd_summary['total'], 'semd_types': semd_summary['registeredTypes'],
    'errors': error_categories['total'],
    'units': {key: [value['fact'], value['plan']] for key, value in unit_data.items() if key in unit_sources},
}, ensure_ascii=False, indent=2))
