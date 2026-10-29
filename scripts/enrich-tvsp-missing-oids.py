#!/usr/bin/env python3
"""Add source-confirmed non-transmitting SP identifiers without recalculating facts."""
import argparse, hashlib, json, sys
from pathlib import Path
import openpyxl
sys.path.insert(0, str(Path(__file__).resolve().parent/'pipeline'))
from adapters import oid_list

def enrich(app, sources):
    target = app/'unit-data.json'
    data = json.loads(target.read_text())
    specs = {
        'tvspAmbulatory': '*Эпикриз по законч*.xlsx',
        'tvspStationary': '*Эпикриз_в_стац*.xlsx',
        'tvspLaboratory': '*Протокол лабораторного*.xlsx',
    }
    audit = []
    for metric, pattern in specs.items():
        files = list(sources.glob(pattern))
        if len(files) != 1: raise ValueError(f'{metric}: expected one source, got {len(files)}')
        path = files[0]
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        source_rows = {}
        for number, row in enumerate(wb['Детализация по СП'].values, 1):
            if len(row)<7 or row[0]!='Республика Татарстан': continue
            planned, passed = set(oid_list(row[4])), set(oid_list(row[5]))
            if not planned: continue
            missing = planned-passed
            explicit = set(oid_list(row[6]))
            if explicit != missing: raise ValueError(f'{path.name}:{number}: inconsistent missing OIDs')
            key = (str(row[2]),str(row[3]))
            if key in source_rows: raise ValueError(f'duplicate source key {key}')
            source_rows[key] = (planned, planned & passed, sorted(missing))
        rows = data[metric]['rows']
        if len(rows) != len(source_rows): raise ValueError(f'{metric}: row count mismatch')
        for row in rows:
            planned, passed, missing = source_rows[(row['moOid'],row['buildingIds'])]
            if (set(oid_list(row['unitOid'])) != planned or row['plannedSubunits'] != len(planned)
                    or row['registeredSubunits'] != len(passed)):
                raise ValueError(f'{metric}: accepted counts do not match source')
            row['missingUnitOids'] = missing
        audit.append({'metric':metric,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                      'objects':len(rows),'missingSubunits':sum(len(r['missingUnitOids']) for r in rows)})
        wb.close()
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    return audit

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--app',type=Path,required=True);parser.add_argument('--sources',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(enrich(args.app,args.sources),ensure_ascii=False,indent=2))
