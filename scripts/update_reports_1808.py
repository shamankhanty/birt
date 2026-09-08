#!/usr/bin/env python3
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from openpyxl import load_workbook

SITE = Path(__file__).resolve().parents[1]
UP = Path('/workspace/scratch/8e713f374d53/upload')

def one(pattern):
    files = sorted(UP.glob(pattern))
    if not files: raise FileNotFoundError(pattern)
    return files[-1]

def text(value): return '' if value is None else str(value).strip()

def norm(value):
    value = text(value).lower().replace('ё', 'е')
    value = re.sub(r'["«»]', '', value)
    value = re.sub(r'^(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во)(?:\s+рт)?\s+', '', value)
    replacements = {
        'городская поликлиника': 'гп',
        'городская клиническая больница': 'гкб',
        'городская больница': 'гб',
        'центральная районная больница': 'црб',
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    value = value.replace('г. казани', 'казань').replace('г. казань', 'казань')
    value = value.replace('г. наб.челны', 'наб челны').replace('г. набережные челны', 'наб челны')
    value = re.sub(r'\s*№\s*', '№', value)
    return re.sub(r'[^а-яa-z0-9№]+', ' ', value).strip()

def registry_oid_index():
    registry = json.loads((SITE / 'app' / 'mo-registry.json').read_text(encoding='utf-8'))
    candidates = defaultdict(set)
    for organization in registry['organizations']:
        oid = text(organization.get('oid'))
        if not oid:
            continue
        names = [organization.get('name'), organization.get('shortName'), *organization.get('aliases', [])]
        for name in names:
            key = norm(name)
            if key:
                candidates[key].add(oid)
    return candidates

def dump(name, value):
    (SITE / 'app' / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def metric_headers(ws, name_row, format_row, start_col):
    name_values = next(ws.iter_rows(min_row=name_row, max_row=name_row, values_only=True))
    format_values = next(ws.iter_rows(min_row=format_row, max_row=format_row, values_only=True))
    result = []
    last = ''
    for idx in range(start_col, ws.max_column + 1):
        name = text(name_values[idx - 1])
        if name: last = name
        result.append((idx, last, text(format_values[idx - 1])))
    return result

remd_path = one('Медкнижки*17.08*.xlsx')
wb = load_workbook(remd_path, read_only=True, data_only=True)
header_wb = load_workbook(remd_path, read_only=True, data_only=False)
summary = wb['Отчет РЭМД']
headers = metric_headers(header_wb['Отчет РЭМД'], 5, 6, 4)
combined = defaultdict(lambda: {'count': 0, 'formats': []})
summary_values = next(summary.iter_rows(min_row=8, max_row=8, values_only=True))
for idx, name, fmt in headers:
    if not name: continue
    value = summary_values[idx - 1]
    count = int(value) if isinstance(value, (int, float)) else 0
    combined[name]['count'] += count
    if fmt and fmt not in combined[name]['formats']: combined[name]['formats'].append(fmt)
semd_summary = {
    'period': '01.01.2026–17.08.2026',
    'formed': '18.08.2026 10:39',
    'total': int(summary_values[2]),
    'registeredTypes': int(summary_values[1]),
    'items': [{'name': name, 'count': item['count'], 'format': ' / '.join(item['formats']) or '—'} for name, item in combined.items()],
}
if sum(item['count'] for item in semd_summary['items']) != semd_summary['total']:
    raise ValueError('Сумма видов СЭМД не равна итогу РЭМД')
dump('semd-summary.json', semd_summary)

# Полная выгрузка отказов: группируем категории и сохраняем полный итог.
errors_path = one('Отчёт - Отказы*17.08*.xlsx')
ews = load_workbook(errors_path, read_only=True, data_only=True).active
categories = Counter()
for row in ews.iter_rows(min_row=6, values_only=True):
    description, count = text(row[8]), row[9]
    if description and isinstance(count, (int, float)): categories[description] += int(count)
error_total = sum(categories.values())
dump('error-categories.json', {
    'total': error_total,
    'period': '01.01–17.08.2026',
    'items': [{'name': name, 'count': count} for name, count in categories.most_common()],
})

# ЭЛМК: плановый перечень берём из уже утверждённого справочника, факт обновляем по OID.
status_path = SITE / 'app' / 'organization-status.json'
status = json.loads(status_path.read_text(encoding='utf-8'))
registry_oids = registry_oid_index()
mo_ws = wb['Отчет РЭМД по МО']
mo_headers = metric_headers(header_wb['Отчет РЭМД по МО'], 5, 6, 6)
elmk_cols = [idx for idx, name, _ in mo_headers if 'подсистем' in name.lower() and 'элмк' in name.lower()]
if not elmk_cols:
    elmk_cols = [idx for idx, name, _ in mo_headers if 'медицинское заключение' in name.lower() and 'осмотр' in name.lower()]
elmk_by_oid = defaultdict(int)
for row in mo_ws.iter_rows(min_row=8, values_only=True):
    oid = text(row[2])
    if not oid: continue
    elmk_by_oid[oid] += sum(int(row[idx-1] or 0) for idx in elmk_cols if isinstance(row[idx-1], (int, float)))
elmk_same_slice = status['elmk'].get('date') == '17.08.2026'
for item in status['elmk']['rows']:
    oid_candidates = registry_oids.get(norm(item.get('name')), set())
    if len(oid_candidates) > 1:
        raise ValueError(f'Неоднозначный OID для {item["name"]}: {sorted(oid_candidates)}')
    registry_oid = next(iter(oid_candidates), '')
    source_oid = text(item.get('oid'))
    # Плановый перечень ЭЛМК идентифицируем по точному названию из мастер-справочника.
    # OID из предыдущего среза нельзя сохранять при конфликте: иначе факт одной
    # номерной поликлиники переносится сразу на несколько других организаций.
    item['oid'] = registry_oid or source_oid
    if not item['oid']:
        raise ValueError(f'В едином справочнике не найден OID для {item["name"]}')
    count = elmk_by_oid.get(item['oid'], 0)
    previous = item.get('previous') if elmk_same_slice else item.get('fact')
    item.update({'count': count, 'previous': previous, 'fact': 100 if count > 0 else 0})
    item['trend'] = item['fact'] - previous if previous is not None else None
status['elmk']['date'] = '17.08.2026'
status['elmk']['period'] = '01.01–17.08.2026'
elmk_fact = sum(row['fact'] > 0 for row in status['elmk']['rows'])
status['elmk']['note'] = f'Плановый перечень — 74 МО. На 17.08.2026 передача СЭМД подтверждена у {elmk_fact} МО; сравнение — со срезом на 06.08.2026.'
if len(status['elmk']['rows']) != 74:
    raise ValueError(f'Контроль ЭЛМК не пройден: получено {len(status["elmk"]["rows"])} строк вместо 74')
if any(not text(row.get('oid')) for row in status['elmk']['rows']):
    raise ValueError('Контроль ЭЛМК не пройден: есть строки без OID')

# Протокол ТМК: 39 положительных строк; нулевая МО остаётся из утверждённого перечня 40 МО.
tmk_path = one('Отчет_ТМК_РЭМД*18.08*.xlsx')
tws = load_workbook(tmk_path, read_only=True, data_only=True)['Детализированный отчет']
tmk_by_oid = {}
for row in tws.iter_rows(min_row=7, values_only=True):
    if text(row[1]) != 'Республика Татарстан' or not text(row[3]): continue
    tmk_by_oid[text(row[3])] = int(row[4] or 0)
for item in status['tmkRemd']['rows']:
    count = tmk_by_oid.get(text(item.get('oid')), 0)
    previous = item.get('fact')
    item.update({'count': count, 'previous': previous, 'fact': 100 if count > 0 else 0})
    item['trend'] = item['fact'] - previous if previous is not None else None
status['tmkRemd']['date'] = '17.08.2026'
status['tmkRemd']['period'] = '01.01–17.08.2026'
status['tmkRemd']['note'] = 'План — 100%. В плановом перечне 40 МО: 39 зарегистрировали СЭМД, одна МО имеет нулевой результат.'
dump('organization-status.json', status)

print(json.dumps({
    'semd_total': semd_summary['total'],
    'semd_types': semd_summary['registeredTypes'],
    'error_total': error_total,
    'error_categories': len(categories),
    'elmk_columns': len(elmk_cols),
    'elmk_fact': sum(row['fact'] > 0 for row in status['elmk']['rows']),
    'tmk_fact': sum(row['fact'] > 0 for row in status['tmkRemd']['rows']),
}, ensure_ascii=False))
