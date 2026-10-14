"""Import the approved full September report, reconciling every regional total."""
import json
import hashlib
import sys
from datetime import date
from pathlib import Path
import openpyxl
from pipeline.adapters import adapt_physicians, parse_physicians, SPECIALTIES

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
assert all('2026' in str(list(s.values)[1]) and 'Сентябрь' in str(list(s.values)[1]) for s in wb)
current = parse_physicians(source, root/'app/mo-registry.json')
all_rows = [r for r in wb['Все врачи_Детализация по МО'].values if r[0]=='Республика Татарстан' and r[1]]
assert len(all_rows)==len({r[1] for r in all_rows})
assert all(isinstance(r[4], (int,float)) and isinstance(r[6], (int,float)) and 0<=r[6]<=r[4] for r in all_rows)
subject = next(r for r in wb['Все врачи_По субъекту РФ'].values if r[0]=='Республика Татарстан')
assert (sum(r['count'] for r in current['doctorsAll']),sum(r['volume'] for r in current['doctorsAll'])) == (subject[3],subject[1])
specialties = [r for r in wb['Врачи по спец-тям_По МО'].values if r[0]=='Республика Татарстан' and r[1] and r[4] in SPECIALTIES]
assert len(specialties)==len({(r[1],r[4]) for r in specialties})
result = adapt_physicians(root/'app',source,date(2026,9,30),root/'app/mo-registry.json')
target=root/'app/physician-metrics.json'
payload=json.loads(target.read_text(encoding='utf-8'))
payload['sourceFormed']='14.10.2026'
payload['quality'].update(allMoOids=len({r[1] for r in all_rows}),specialtyMoOids=len({r[1] for r in specialties}))
target.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
audit={'source':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'period':'01.09–30.09.2026','formed':'14.10.2026','quality':payload['quality'],'facts':result.facts}
(root/'docs/september-2026-physician-import.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(audit,ensure_ascii=False))
