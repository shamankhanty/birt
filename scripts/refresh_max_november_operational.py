#!/usr/bin/env python3
"""Refresh the direct November MAX view without changing cumulative or closed cuts."""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'pipeline'))
from adapters import parse_max, source_rows  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

SPASSK_SOURCE_OID = '1.2.643.5.1.13.13.12.2.16.1094'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'app' / 'max-period-views.json')
    args = parser.parse_args()
    book = load_workbook(args.source, read_only=True, data_only=True)
    try:
        heading = str(book['Лист1']['A1'].value)
    finally:
        book.close()
    match = re.fullmatch(r'Посредством национального мессенджера МАХ за период с 01\.11\.2026 по (\d{2})\.11\.2026', heading)
    if not match:
        raise ValueError(f'Не подтверждён период ноябрьского отчёта: {heading}')
    end = f'{match[1]}.11.2026'
    views = json.loads(args.output.read_text(encoding='utf-8'))
    old = views['operational']
    if old['date'] >= end or not old['period'].startswith('01.11'):
        raise ValueError('Ожидается более новый сопоставимый ноябрьский срез')
    updated = {**old, 'date': end, 'period': f'01.11–{end}',
               'source': args.source.name, 'previousDate': old['date'],
               'previousPeriod': old['period'], 'previousSource': old['source'],
               'metrics': {}}
    for service, (metric, column) in {'tmk': ('tmkMaxCount', 3), 'eln': ('elnMaxCount', 4)}.items():
        raw = parse_max(args.source, column)
        resolved = source_rows(raw, metric)
        by_oid = {row['oid']: row for row in resolved if row.get('oid')}
        before = old['metrics'][service]
        rows = []
        for prior in before['rows']:
            oid = prior['oid']
            source_oid = SPASSK_SOURCE_OID if oid.endswith('.18650') else oid
            item = by_oid.get(source_oid)
            rows.append({**prior, 'fact': item['count'] if item else None,
                         'previous': prior['fact']})
        fact = sum(row['fact'] for row in rows if row['fact'] is not None)
        total = sum(row['count'] for row in raw)
        if fact > total or any(row['fact'] is not None and row['previous'] is not None
                               and row['fact'] < row['previous'] for row in rows):
            raise ValueError(f'Несопоставимые месячные значения {service}')
        updated['metrics'][service] = {
            **before, 'sourceTotal': total,
            'previousSourceTotal': before['sourceTotal'],
            'plannedMoFact': fact,
            'previousPlannedMoFact': before['plannedMoFact'],
            'plannedCoverage': {'matched': sum(row['fact'] is not None for row in rows),
                                'missing': sum(row['fact'] is None for row in rows)},
            'sourcePerimeterNote': before['sourcePerimeterNote'] +
                ' Новые строки без подтверждённого планового OID остаются вне планового итога;'
                ' отсутствие строки не приравнивается к нулю.',
            'rows': rows,
        }
    views['operational'] = updated
    args.output.write_text(json.dumps(views, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: {'sourceTotal': item['sourceTotal'],
                            'plannedMoFact': item['plannedMoFact'],
                            'plannedCoverage': item['plannedCoverage']}
                      for key, item in updated['metrics'].items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
