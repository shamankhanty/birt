"""Stage the approved October preventive cut without changing frozen monthly data."""
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path

import openpyxl
from pipeline.adapters import adapt_preventive, parse_foms, parse_remd

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def stage(sources, output):
    remd = next(sources.rglob('1.Отчет СЭМД_РЭМД*.xlsx'))
    foms = next(sources.rglob('Количество_СЭМД_Результаты*.xlsx'))
    evidence = []
    for source in (remd, foms):
        book = openpyxl.load_workbook(source, read_only=True, data_only=True)
        sheet = book['Отчет РЭМД по МО'] if source == remd else book.active
        headings = ' '.join(str(v) for row in sheet.iter_rows(max_row=4, values_only=True) for v in row if v)
        assert '01.01.2026' in headings and '31.10.2026' in headings
        evidence.append({'file': source.name, 'sheet': sheet.title,
                         'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    rr, ff = parse_remd(remd), parse_foms(foms)
    old_audit = read(ROOT / 'app/preventive-semd-audit.json')
    approved_missing = {r['oid'] for r in old_audit['excluded']}
    assert set(ff) - set(rr) == approved_missing
    assert all(ff[r['oid']]['den'] == r['denominator'] for r in old_audit['excluded'])
    matched = set(ff) & set(rr)
    # Independently locate columns by their source headings and reject missing
    # numeric components before the legacy adapters can coerce blanks to zero.
    for source in (remd, foms):
        book = openpyxl.load_workbook(source, read_only=True, data_only=True)
        sheet = book['Отчет РЭМД по МО'] if source == remd else book.active
        values = list(sheet.values)
        header_index, header = next((i, r) for i, r in enumerate(values)
                                   if any('OID' in str(v) for v in r))
        oid_col = next(i for i, v in enumerate(header) if 'OID' in str(v))
        tokens = ['Сведения о результатах диспансеризации', 'Результаты профилактического медицинского осмотра /'] if source == remd else ['Количество обращений']
        cols = [next(i for i, v in enumerate(header) if str(v).startswith(token)) for token in tokens]
        records = [r for r in values[header_index + 1:] if r[oid_col] in matched]
        assert len(records) == len(matched)
        for row in records:
            assert all(isinstance(row[c], (int, float)) for c in cols), row[oid_col]
            expected = [rr[row[oid_col]]['s122'], rr[row[oid_col]]['s228']] if source == remd else [ff[row[oid_col]]['den']]
            assert [row[c] for c in cols] == expected
        item = next(e for e in evidence if e['file'] == source.name)
        item.update(matchedRows=len(records), firstOid=records[0][oid_col], lastOid=records[-1][oid_col])
    assert len(matched) == 95
    assert sum(max(rr[k]['s122'], rr[k]['s228']) for k in matched) == 2201997
    assert sum(ff[k]['den'] for k in matched) == 2419529
    attribution = read(ROOT / 'config/rkb-spassk-branch.json')['preventiveAttribution']
    oid = attribution['sourceOid']
    assert (rr[oid]['s122'], rr[oid]['s228'], ff[oid]['den']) == (7309, 6076, 8369)
    app = output / 'candidate/app'
    app.mkdir(parents=True, exist_ok=False)
    for source in (ROOT / 'app').glob('*.json'):
        shutil.copy2(source, app / source.name)
    frozen_monthly = (app / 'monthly-mo.json').read_bytes()
    result = adapt_preventive(app, remd, foms, date(2026, 10, 31),
                              ROOT / 'app/mo-registry.json', approved_missing)
    # This export is cumulative January–October, not a separate October month.
    (app / 'monthly-mo.json').write_bytes(frozen_monthly)
    audit = read(app / 'preventive-semd-audit.json')
    audit['summary']['attributionNote'] = attribution['basis']
    write(app / 'preventive-semd-audit.json', audit)
    changed = [name for name in result.changedFiles
               if (app / name).read_bytes() != (ROOT / 'app' / name).read_bytes()]
    report = {'state': 'READY', 'statistics': {'preparedIndicators': 1},
              'indicators': [{'metric': 'semd228', 'state': 'PREPARED'}],
              'changedFiles': changed, 'sources': evidence,
              'monthlySnapshotUnchanged': True, 'attribution': attribution,
              'summary': audit['summary'], 'excluded': audit['excluded']}
    write(output / 'report.json', report)
    print(json.dumps({'changedFiles': changed, 'summary': audit['summary']}, ensure_ascii=False))


if __name__ == '__main__':
    stage(Path(sys.argv[1]), Path(sys.argv[2]))
