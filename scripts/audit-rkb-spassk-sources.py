"""Read-only reconciliation of RKB/Spassk identities and preventive sources.

Usage: python3 scripts/audit-rkb-spassk-sources.py RKB.xlsx FRMO.xlsx SOURCE_DIR
The output is evidence, not permission to promote any numeric result.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import openpyxl


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(rkb_path, frmo_path, source_dir):
    catalog = json.loads((Path(__file__).resolve().parents[1] / 'config/rkb-spassk-branch.json').read_text())
    rkb = openpyxl.load_workbook(rkb_path, read_only=True, data_only=True)
    identities = {}
    for sheet, units in [('РКБ', catalog['parentSubunits']), ('Спаск', catalog['subunits'])]:
        rows = list(rkb[sheet].values)[1:]
        oids = {r[2] for r in rows if r[2]}
        buildings = {str(r[4]) for r in rows if r[4]}
        assert oids == {u['spOid'] for u in units}
        assert buildings == {b for u in units for b in u.get('buildingIds', [u.get('buildingId')])}
        assert all(r[1] == catalog['parent']['oid'] for r in rows)
        identities[sheet] = {'rows': len(rows), 'subunits': len(oids), 'buildings': len(buildings)}
    assert not ({u['spOid'] for u in catalog['subunits']} & {u['spOid'] for u in catalog['parentSubunits']})
    spassk = {u['spOid'] for u in catalog['subunits']}
    frmo = openpyxl.load_workbook(frmo_path, read_only=True, data_only=True)
    rows = [(i, r) for i, r in enumerate(frmo['Отделения и СП (филиалы)'].values, 1) if str(r[0]) == '4001']
    frmo_check = {
        'sourceRows': len(rows), 'mismatchedLinks': sum(r[4] != r[8] for _, r in rows),
        'matchingDepartmentRows': sum(r[8] in spassk for _, r in rows),
        'missingDepartmentOid': sum(not r[8] for _, r in rows),
        'foreignDepartmentOid': sum(bool(r[8]) and r[8] not in spassk for _, r in rows),
        'branchParentCounts': dict(Counter(str(r[4]).split('.0.')[0] for _, r in rows)),
    }
    files = list(source_dir.rglob('*.xlsx'))
    paths = [next(p for p in files if p.name.startswith(prefix)) for prefix in
             ['1.Отчет СЭМД_РЭМД', 'Закрытые случаи', 'Количество_СЭМД_Результаты']]
    components = []
    oid = catalog['parent']['oid']
    for path in paths:
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheet = book['Отчет РЭМД по МО'] if 'Отчет РЭМД по МО' in book.sheetnames else book.active
        headings = ' '.join(str(v) for row in list(sheet.values)[:4] for v in row if v)
        assert '01.01.2026' in headings and '31.10.2026' in headings
        matches = [(i, row) for i, row in enumerate(sheet.values, 1) if oid in row[:3]]
        assert len(matches) == 1
        i, row = matches[0]
        item = {'file': path.name, 'sha256': digest(path), 'sheet': sheet.title, 'row': i,
                'period': '01.01–31.10.2026', 'sourceOid': oid}
        if path.name.startswith('1.Отчет'):
            item.update(scope='legal-entity-remd', semd122=row[80], semd228=row[107])
        elif path.name.startswith('Закрытые'):
            item.update(scope='closed-gis-cases', semd122=row[9], semd228=row[13],
                        closedCases=sum(v for v in row[3:5] if isinstance(v, (int, float))))
        else:
            item.update(scope='preventive-encounters', encounters=row[2], semd228=row[3])
        components.append(item)
    return {
        'verifiedAt': '2026-11-04', 'identityStatus': 'confirmed',
        'sources': [{'file': p.name, 'sha256': digest(p)} for p in (rkb_path, frmo_path)],
        'structure': identities, 'overlappingSubunitOids': 0, 'frmo': frmo_check,
        'preventiveComponents': components,
        'preventiveStatus': 'branch-numerator-attribution-pending',
        'limitation': 'Общий РЭМД содержит итог юридического лица; специальный отчёт ГИС считает зарегистрированные документы по закрытым случаям. Равенство периода и OID не доказывает одинаковый охват. В РКБ.xlsx нет СЭМД 122/228 и отчётного периода. Числовой факт филиала автоматически не переносится.',
    }


if __name__ == '__main__':
    print(json.dumps(audit(*(Path(p) for p in sys.argv[1:4])), ensure_ascii=False, indent=2))
