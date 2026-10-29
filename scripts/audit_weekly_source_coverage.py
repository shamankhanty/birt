#!/usr/bin/env python3
"""Read-only source recovery and replay audit; never changes production or Disk."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.error
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from yandex_disk_inbox import API, request_json, download_file


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def list_files(remote, token):
    pending = [remote]
    while pending:
        folder = pending.pop()
        offset = 0
        while True:
            query = urllib.parse.urlencode({'path': folder, 'limit': 1000, 'offset': offset,
                'fields': '_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.sha256,_embedded.total'})
            data = request_json(f'{API}?{query}', token).get('_embedded', {})
            items = data.get('items', [])
            for item in items:
                if item['type'] == 'dir':
                    pending.append(item['path'])
                elif not item['name'].startswith('~$'):
                    yield item
            offset += len(items)
            if not items or offset >= data.get('total', offset):
                break


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable(value):
    """Current quantitative values only; previous cuts are intentionally excluded."""
    if isinstance(value, list):
        return [stable(x) for x in value]
    if isinstance(value, dict):
        fields = {'oid', 'fact', 'value', 'count', 'volume', 'numerator', 'denominator',
                  'registered', 'total', 'date', 'period', 'rows', 'summary', 'plan',
                  'moOid', 'unitOid', 'buildingIds', 'plannedSubunits', 'registeredSubunits', 'partial',
                  'items', 'organizations', 'sourcePeriod', 'totalErrors', 'categories'}
        return {k: stable(v) for k, v in value.items() if k in fields}
    return value


def check_supplemental_views(found):
    """Recompute the views prepared outside transactional staging from primary Excel."""
    from collections import defaultdict
    from openpyxl import load_workbook
    sys.path.insert(0, str(ROOT / 'scripts/pipeline'))
    from adapters import parse_max, source_rows
    checks = []
    views = json.loads((ROOT/'app/max-period-views.json').read_text(encoding='utf-8'))
    for kind, prefix in [('cumulative', 'ТМК_МАХ -01.01'), ('operational', 'ТМК_МАХ 01.10')]:
        source = next((path for name, path in found.items() if name.startswith(prefix)), None)
        if source is None:
            checks.append({'view': kind, 'status': 'MISSING_SOURCE'})
            continue
        for service, metric, col in [('tmk', 'tmkMaxCount', 3), ('eln', 'elnMaxCount', 4)]:
            raw = parse_max(source, col)
            resolved = {r.get('oid'): r for r in source_rows(raw, metric) if r.get('oid')}
            current = views[kind]['metrics'][service]
            mismatches = [row['oid'] for row in current['rows'] if row.get('fact') != (resolved.get(row['oid']) or {}).get('fact')]
            total = sum(row['count'] for row in raw)
            checks.append({'view': f'maxPeriodViews.{kind}.{service}', 'source': source.name,
                'status': 'PASS' if total == current['sourceTotal'] and not mismatches else 'FAIL',
                'sourceTotal': total, 'displayedSourceTotal': current['sourceTotal'],
                'checkedPlannedOrganizations': len(current['rows']), 'mismatchedOrganizations': len(mismatches)})
    source = next((path for name, path in found.items() if name.startswith('1.Отчет СЭМД_РЭМД')), None)
    if source:
        book = load_workbook(source, read_only=True, data_only=True)
        rows = list(book['Отчет РЭМД'].values); book.close()
        names, formats, values = rows[4], rows[5], rows[7]
        grouped = defaultdict(int); last = ''
        for index in range(3, len(values)):
            if names[index]: last = str(names[index]).strip()
            if not last: continue
            value = values[index]
            if value is None and names[index] is None and formats[index] is None: continue
            if not isinstance(value, (int, float)) or value < 0: raise ValueError('Invalid SEMD summary component')
            grouped[last] += int(value)
        current = json.loads((ROOT/'app/semd-summary.json').read_text(encoding='utf-8'))
        present = {row['name']: row['count'] for row in current['items']}
        checks.append({'view': 'semdSummary', 'source': source.name,
            'status': 'PASS' if dict(grouped) == present and sum(grouped.values()) == current['total'] == int(values[2]) and sum(x > 0 for x in grouped.values()) == current['registeredTypes'] == int(values[1]) else 'FAIL',
            'sourceTotal': int(values[2]), 'registeredTypes': int(values[1]), 'checkedDocumentTypes': len(grouped)})
        control = json.loads((ROOT/'app/federal-control.json').read_text(encoding='utf-8'))
        for point, needle in [('37','Экстренное извещение об инфекционном заболевании'),('38','Выписка из протокола решения врачебной комиссии'),('39','Льготный рецепт')]:
            matches = [value for name, value in grouped.items() if (name.casefold() == needle.casefold() if point == '38' else name.casefold().startswith(needle.casefold()))]
            row = next(row for row in control['agreement'] if row['id'] == point)
            import re
            actual = int(re.sub(r'\D', '', row.get('regionalFact', '')) or '-1')
            checks.append({'view': f'federal.agreement.{point}', 'source': source.name,
                'status': 'PASS' if len(matches) == 1 and actual == matches[0] else 'FAIL',
                'sourceCount': matches[0] if len(matches) == 1 else None, 'displayedCount': actual})
    return checks


def run(args):
    evidence = json.loads((ROOT / args.evidence).read_text(encoding='utf-8'))
    expected = evidence['sourceFiles']
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Keep original workbooks outside the report artifact.
    sources = output.parent / (output.name + '-private-sources')
    sources.mkdir(parents=True, exist_ok=True)
    report = {'schemaVersion': 1, 'evidence': args.evidence, 'expectedFiles': len(expected),
              'readOnly': True, 'sources': [], 'remoteErrors': [], 'replay': {'status': 'NOT_RUN'},
              'fullWorkbookCoverage': 'NOT_ESTABLISHED',
              'limitation': 'Inventory and deterministic replay do not prove that every worksheet and column is consumed by the adapters.'}
    found = {}
    candidates = []
    token = os.environ.get('YANDEX_DISK_TOKEN')
    if args.local:
        candidates = [{'name': p.name, 'local': p} for p in args.local.rglob('*') if p.is_file()]
    elif token:
        for remote in args.remote:
            try:
                candidates.extend(list_files(remote, token))
            except (urllib.error.URLError, OSError) as error:
                report['remoteErrors'].append({'root': remote, 'error': type(error).__name__})
    else:
        report['remoteErrors'].append({'error': 'YANDEX_DISK_TOKEN is not configured'})
    report['remoteCandidateFiles'] = len(candidates)
    for item in candidates:
        name = item['name']
        if name not in expected or name in found:
            continue
        target = sources / (hashlib.sha256(name.encode()).hexdigest()[:16] + '.xlsx')
        try:
            if 'local' in item:
                shutil.copyfile(item['local'], target)
            else:
                download_file(item['path'], target, token)
            if digest(target) == expected[name]:
                # Preserve recognizable names for the existing adapters. Linux permits 255 bytes.
                safe = sources / name
                if len(name.encode('utf-8')) <= 255:
                    target.rename(safe)
                else:
                    # The pipeline recognizes long names by workbook content as well.
                    safe = target
                found[name] = safe
        except (urllib.error.URLError, OSError) as error:
            report['remoteErrors'].append({'source': name, 'error': type(error).__name__})
        finally:
            if target.exists() and name not in found:
                target.unlink()
    # ZIPs are inspected only when they contain the exact expected workbook names.
    for item in candidates:
        if len(found) == len(expected):
            break
        if not item['name'].lower().endswith('.zip'):
            continue
        tmp = sources / '_archive.zip'
        try:
            if 'local' in item:
                shutil.copyfile(item['local'], tmp)
            else:
                download_file(item['path'], tmp, token)
            with zipfile.ZipFile(tmp) as archive:
                for member in archive.infolist():
                    name = Path(member.filename).name
                    if not name.lower().endswith('.xlsx') or member.file_size > 256 * 1024 * 1024:
                        continue
                    data = archive.read(member)
                    # Legacy Windows ZIPs may omit the UTF-8 filename flag (CP866).
                    # The accepted content hash is authoritative, even for a garbled filename.
                    actual_hash = hashlib.sha256(data).hexdigest()
                    name = next((key for key, value in expected.items() if value == actual_hash), None)
                    if name is None or name in found:
                        continue
                    safe = sources / (name if len(name.encode()) <= 255 else hashlib.sha256(name.encode()).hexdigest()[:16] + '.xlsx')
                    safe.write_bytes(data)
                    found[name] = safe
        except (urllib.error.URLError, OSError, zipfile.BadZipFile) as error:
            report['remoteErrors'].append({'archive': item['name'], 'error': type(error).__name__})
        finally:
            tmp.unlink(missing_ok=True)
    from openpyxl import load_workbook
    for name, expected_hash in expected.items():
        entry = {'name': name, 'expectedSha256': expected_hash, 'status': 'MISSING'}
        if name in found:
            entry['status'] = 'HASH_MATCH'
            entry['sheets'] = []
            book = load_workbook(found[name], read_only=True, data_only=True)
            for sheet in book.worksheets:
                nonempty = 0
                first = last = None
                for index, row in enumerate(sheet.iter_rows(values_only=True), 1):
                    if any(cell is not None for cell in row):
                        nonempty += 1
                        if first is None:
                            first = index
                        last = index
                entry['sheets'].append({'name': sheet.title, 'nonEmptyRows': nonempty,
                    'firstNonEmptyRow': first, 'lastNonEmptyRow': last, 'columns': sheet.max_column,
                    'parserCoverage': 'NOT_ESTABLISHED'})
            book.close()
        report['sources'].append(entry)
    report['matchedFiles'] = len(found)
    report['supplementalChecks'] = check_supplemental_views(found) if len(found) == 18 else []
    write(output / 'source-coverage.json', report)
    if args.replay and len(found) == len(expected):
        sys.path.insert(0, str(ROOT / 'scripts/pipeline'))
        from transactional_stage import stage
        try:
            replay = stage(sources, output.parent / (output.name + '-private-replay'))
            report['replay'] = {'status': replay['status'], 'statistics': replay['statistics'],
                'indicators': [{k: item.get(k) for k in ('metric', 'state', 'sources', 'errors', 'facts', 'repeatability')} for item in replay['indicators']],
                'differences': []}
            candidate = Path(replay['stagingApp'])
            for filename in ('mo-data.json', 'operational-mo.json', 'organization-status.json', 'physician-metrics.json',
                             'physician-weekly-snapshot.json', 'unit-data.json', 'preventive-semd-audit.json',
                             'error-categories.json', 'error-organizations.json', 'error-cumulative.json'):
                before = json.loads((ROOT / 'app' / filename).read_text(encoding='utf-8'))
                after = json.loads((candidate / filename).read_text(encoding='utf-8'))
                if filename == 'physician-metrics.json':
                    before, after = before['datasets'], after['datasets']
                if 'datasets' in before and filename == 'physician-weekly-snapshot.json':
                    before, after = before['datasets'], after['datasets']
                for metric in before.keys() | after.keys():
                    if stable(before.get(metric)) != stable(after.get(metric)):
                        report['replay']['differences'].append({'dataset': filename, 'metric': metric,
                            'status': 'CURRENT_VALUES_DIFFER', 'requiresReview': True})
        except Exception as error:
            report['replay'] = {'status': 'FAIL', 'error': type(error).__name__, 'message': str(error)[:1200]}
    report['acceptedSourceReplay'] = {
        'allFilesIdenticalToAcceptedPackage': len(found) == len(expected),
        'allCurrentValuesMatch': not report['replay'].get('differences') and all(x['status'] == 'PASS' for x in report['supplementalChecks']) if report['replay']['status'] not in ('NOT_RUN', 'FAIL') else None,
    }
    report['status'] = 'PARTIAL' if len(found) != len(expected) or report['replay']['status'] != 'PASS' or report['replay'].get('differences') else 'REPLAY_MATCH'
    write(output / 'source-coverage.json', report)
    lines = ['# Сверка исходников еженедельного пакета', '', f"Исходники с совпавшим SHA-256: {len(found)} из {len(expected)}.",
             f"Повторная обработка: {report['replay']['status']}.", '', '## Файлы', '']
    lines += [f"- {x['status']}: {x['name']}" for x in report['sources']]
    lines += ['', '## Границы проверки', '', report['limitation'], '', 'Исходные Excel и строки пациентов/врачей в отчёт не включены. Production и файлы на Диске не изменены.']
    (output / 'source-coverage.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'matchedFiles': len(found), 'expectedFiles': len(expected), 'replay': report['replay']['status']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', default='docs/update-20261025-evidence.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--remote', action='append', default=[])
    parser.add_argument('--local', type=Path)
    parser.add_argument('--replay', action='store_true')
    run(parser.parse_args())


if __name__ == '__main__':
    main()
