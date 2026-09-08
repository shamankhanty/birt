#!/usr/bin/env python3
"""Update only the operational 07.09.2026 facts that have valid sources."""
import json
from collections import Counter
from pathlib import Path
import openpyxl

ROOT=Path(__file__).resolve().parents[1]; APP=ROOT/'app'
SRC=Path('/workspace/scratch/1f5740e14d75/analysis_vks_2026-09-07/ВКС исходники 07.09.26')
path=next(SRC.glob('Отчёт - Отказы*'))
ws=openpyxl.load_workbook(path,read_only=True,data_only=True).active
counts=Counter()
for row in ws.iter_rows(min_row=7,values_only=True):
    if row[2]: counts[str(row[8] or row[7] or 'Без описания')]+=int(row[9] or 0)
payload=json.loads((APP/'error-categories.json').read_text(encoding='utf-8'))
payload.update({
    'total':sum(counts.values()),'period':'01.01–07.09.2026','share':None,
    'shareDate':'07.09.2026','shareSource':'Доля не рассчитана: в выгрузке отказов отсутствует знаменатель всех обработанных запросов',
    'successfulRequests':None,
    'items':[{'name':name,'count':count} for name,count in counts.most_common()]
})
(APP/'error-categories.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'errors':payload['total'],'categories':len(payload['items']),'period':payload['period']},ensure_ascii=False))
