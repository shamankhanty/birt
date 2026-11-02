#!/usr/bin/env python3
"""Independent read-only reconciliation. No production importer is used.

Usage: python scripts/audit-november-2026-sources.py SOURCE_DIRECTORY
Only aggregate checks and organization identifiers are written; no patient or
physician personal details leave the original workbook.
"""
import sys, json, re, hashlib, subprocess
from pathlib import Path
from collections import defaultdict
from openpyxl import load_workbook

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
read = lambda name: json.loads((root / 'app' / (name + '.json')).read_text())
evidence = json.loads((root / 'docs/update-20261102-evidence.json').read_text())
mo, op, phys, weekly, units = map(read, ['mo-data', 'operational-mo', 'physician-metrics', 'physician-weekly-snapshot', 'unit-data'])
details = read('mo-detail-oids')
checks = []

def eq(label, actual, expected):
    if actual != expected:
        raise AssertionError(f'{label}: actual={actual!r}; source={expected!r}')

def norm(value):
    text = str(value or '').casefold().replace('ё', 'е')
    text = re.sub(r'["«»]', '', text)
    text = re.sub(r'^(?:гауз|гбуз|гбу|фгбу|фгауз|фгаоу\s*во|ао|ооо|чуз)(?:\s+рт)?\s+', '', text)
    return re.sub(r'№\s*', '№', re.sub(r'[^а-яa-z0-9№]+', ' ', text)).strip()

aliases = defaultdict(set)
for org in read('mo-registry')['organizations']:
    for name in [org['name'], org.get('shortName'), *org.get('aliases',[])]:
        aliases[norm(name)].add(org['oid'])
def source_key(name):
    matches=aliases[norm(name)]
    return next(iter(matches)) if len(matches)==1 else norm(name)

def record(metric, path, sheet, raw, rows, columns):
    # raw is keyed by source OID or exact normalized source name, never fuzzy.
    seen = set()
    for r in rows:
        if r.get('sourceStatus') == 'no_source_row':
            eq(metric + ': missing is not zero', r.get('count'), None)
            continue
        key = r.get('oid') if r.get('oid') in raw else norm(r.get('name'))
        if key not in raw:
            raise AssertionError(f'{metric}: no source component for {r.get("oid") or r["name"]}')
        expected = raw[key]
        eq(metric + ': numerator', r['count'], expected[0])
        if len(expected) > 1:
            eq(metric + ': denominator '+str(key), r.get('volume', details.get(metric, {}).get(r.get('oid'), {}).get('volume')), expected[1])
        seen.add(key)
    checks.append(dict(metric=metric, source=path.name, sheet=sheet, columns=columns,
                       sourceOrganizations=len(raw), matchedOrganizations=len(seen),
                       numerator=sum(v[0] for k,v in raw.items() if k in seen),
                       denominator=sum(v[1] for k,v in raw.items() if k in seen) if raw and len(next(iter(raw.values()))) > 1 else None,
                       unmatchedSourceKeys=sorted(set(raw)-seen), status='PASS'))

for src in evidence['sources']:
    p = source / src['file']
    eq(p.name + ': SHA256', hashlib.sha256(p.read_bytes()).hexdigest(), src['sha256'])
    family = src['family']
    if family in ['ambulatory_cases', 'preventive_remd', 'preventive_foms', 'death_certificates']:
        continue  # retained accepted production; not silently approved here
    wb = load_workbook(p, read_only=True, data_only=True)
    if family == 'physicians':
        all_rows = [r for r in wb['Все врачи_Детализация по МО'].values if r[0]=='Республика Татарстан' and r[1]]
        names = ['акушер-гинеколог','общей практики','кардиолог','онколог','офтальмолог','педиатр','стоматолог','терапевт','хирург']
        ids = ['obgyn','gp','cardiologist','oncologist','ophthalmologist','pediatrician','dentist','therapist','surgeon']
        groups = {'doctorsAll': (all_rows, 6, 4, 'Все врачи_Детализация по МО'),
                  'doctorsLevel3': ([r for r in all_rows if r[3]=='III уровень'], 6, 4, 'Все врачи_Детализация по МО')}
        sp = [r for r in wb['Врачи по спец-тям_По МО'].values if r[0]=='Республика Татарстан' and r[1]]
        for name, id in zip(names, ids):
            groups['doctor500_'+id] = ([r for r in sp if name in str(r[4]).lower()], 9, 5, 'Врачи по спец-тям_По МО')
        for id, (rows,n,d,sheet) in groups.items():
            raw = {r[1]:(r[n],r[d]) for r in rows}
            record(id,p,sheet,raw,phys['datasets'][id]['rows'],[n+1,d+1])
            record(id+':operational',p,sheet,raw,weekly['datasets'][id],[n+1,d+1])
            eq(id+': full source coverage', checks[-1]['unmatchedSourceKeys'], [])
            summary = phys['datasets'][id]['summary']
            eq(id+': regional numerator', summary['numerator'], sum(r[n] for r in rows))
            eq(id+': regional denominator', summary['denominator'], sum(r[d] for r in rows))
    elif family == 'egpu_attachment':
        rows = [r for r in wb.active.values if isinstance(r[3],str) and r[3].startswith('1.2.643.')]
        for id,col in [('egpu',5),('egpu2days',6)]:
            raw={}
            for r in rows:
                value=r[col]
                if value is None and col==5:
                    # The report's negative residual J equals final-minus-submitted.
                    assert r[9] == -r[4], 'Unconfirmed blank EPGU numerator'
                    value=r[4]+r[9]
                raw[r[3]]=(value,r[4])
            record(id,p,wb.active.title,raw,mo[id]['rows'],[col+1,5])
            eq(id+': all source rows',checks[-1]['unmatchedSourceKeys'],[])
    elif family == 'hospital_cases':
        raw=defaultdict(lambda:[0,0])
        for r in wb.active.values:
            if isinstance(r[2],str) and r[2].startswith('1.2.643.'):
                raw[r[2]][0]+=(r[4] or 0)+(r[5] or 0);raw[r[2]][1]+=r[3] or 0
        record('hospital',p,wb.active.title,raw,mo['hospital']['rows'],['E+F','D'])
        record('hospitalCount',p,wb.active.title,{k:(v[1],) for k,v in raw.items()},op['hospitalCount']['rows'],['D'])
    elif family == 'asu_smp':
        # Find the header by content; first organization may be at any row.
        raw={}
        for r in wb.active.values:
            if isinstance(r[1],(int,float)) and str(r[0] or '').startswith(('ГАУЗ','ГБУЗ')):
                raw[norm(r[0])] = (r[10],r[1])
        record('smp',p,wb.active.title,raw,mo['smp']['rows'],['K','B'])
        eq('SMP complete',checks[-1]['unmatchedSourceKeys'],[])
        total=next(r for r in wb.active.values if str(r[0] or '').strip()=='Всего')
        eq('SMP regional', (mo['smp']['numerator'],mo['smp']['denominator']),(total[10],total[1]))
    elif family == 'max_tmk_eln':
        rows=[r for r in wb['Лист1'].values if isinstance(r[3],(int,float)) and r[0] and not re.match(r'(?i)^\s*(итого|всего)',str(r[0]))]
        views=read('max-period-views'); monthly='01.10.' in p.name
        for id,col,service in [('tmkMaxCount',3,'tmk'),('elnMaxCount',4,'eln')]:
            # Reuse only the approved identity registry; counts come directly from cells.
            mapped=json.loads(subprocess.check_output(['node',str(root/'scripts/pipeline/resolve-organizations.mjs')],input=json.dumps(dict(metric=id,registry=read('mo-registry'),rows=[dict(name=r[0],count=r[col]) for r in rows]),ensure_ascii=False),text=True))
            raw={r.get('oid') or norm(r['name']):(r['count'],) for r in mapped}
            # Verify the entire source scope, then the approved 85-MO view.
            if not monthly:record(id,p,'Лист1',raw,op[id]['rows'],[col+1])
            view=views['closedMonths']['2026-10']['operational' if monthly else 'cumulative']['metrics'][service]
            eq(id+': source total',view['sourceTotal'],sum(r[col] for r in rows))
            for target in view['rows']:
                expected=raw.get(target['oid'])
                eq(id+': planned MO '+target['oid'],target['fact'],expected[0] if expected else None)
            eq(id+': planned perimeter',view['plannedMoFact'],sum(r['fact'] or 0 for r in view['rows']))
            checks.append(dict(metric=id+(':month' if monthly else ':cumulative'),source=p.name,sheet='Лист1',columns=[col+1],sourceOrganizations=len(rows),numerator=sum(r[col] for r in rows),status='PASS'))
    elif family == 'short_input':
        raw=defaultdict(lambda:[0,0])
        for r in wb.active.values:
            if r[0] and (str(r[1] or '').startswith('1.2.643.') or re.match(r'^(?:ГАУЗ|ГБУЗ|ГБУ|ФГ|АО|ООО|ЧУЗ|ВМС|НМЧУ|КГМА)',str(r[0]))):
                key=r[1] or norm(r[0]);raw[key][0]+=(r[3] or 0)+(r[6] or 0);raw[key][1]+=(r[4] or 0)+(r[5] or 0)
        for id,index in [('shortInput',None),('shortInputAmb',0),('shortInputHosp',1)]:
            vals={k:(sum(v) if index is None else v[index],) for k,v in raw.items()}
            record(id,p,wb.active.title,vals,op[id]['rows'],['D+G','E+F'])
    elif family == 'fap_fp':
        raw=defaultdict(lambda:[0]);count=0
        for r in wb.active.values:
            if str(r[0] or '').startswith(('ГАУЗ','ГБУЗ')):
                raw[norm(r[0])][0]+=r[3] or 0;count+=1
        record('fapSemdCount',p,wb.active.title,raw,op['fapSemdCount']['rows'],['D'])
        eq('FAP complete',checks[-1]['unmatchedSourceKeys'],[])
        eq('FAP source units',sum(r['units'] for r in op['fapSemdCount']['rows']),count)
    elif family == 'birth_certificates':
        raw=defaultdict(lambda:[0,0]);seen=set()
        for r in wb.active.values:
            if hasattr(r[2],'year') and r[1]:
                assert r[1] not in seen;seen.add(r[1]);key=norm(r[0]);raw[key][0]+=int(r[3]=='Зарегистрирован');raw[key][1]+=1
        ds=mo['birth'];eq('birth aggregate',(ds['numerator'],ds['denominator']),(sum(v[0] for v in raw.values()),len(seen)))
        checks.append(dict(metric='birth',source=p.name,sourceOrganizations=len(raw),numerator=ds['numerator'],denominator=len(seen),status='PASS'))
    elif family == 'remd_errors':
        totals=defaultdict(int)
        for r in wb.active.values:
            if r[0]=='Республика Татарстан':totals[r[7]]+=r[9]
        current=read('error-cumulative' if src['sourceStart']=='2026-01-01' else 'error-categories')
        eq('REMD errors total',current['total'],sum(totals.values()))
        eq('REMD error categories', sorted(x['count'] for x in current['items']),sorted(totals.values()))
        checks.append(dict(metric='remdErrors:'+src['sourceStart'],source=p.name,numerator=sum(totals.values()),categories=len(totals),status='PASS'))
    elif family in ['tvsp_ambulatory','tvsp_stationary','tvsp_laboratory']:
        id={'tvsp_ambulatory':'tvspAmbulatory','tvsp_stationary':'tvspStationary','tvsp_laboratory':'tvspLaboratory'}[family]
        raw={}
        oidset=lambda x:set(re.findall(r'1\.2\.643\.[\d.]+',str(x or '')))
        for r in wb['Детализация по СП'].values:
            if r[0]=='Республика Татарстан':
                need=oidset(r[4]);sent=oidset(r[5]);raw[(r[2],str(r[3]))]=(need,need-sent)
        for r in units[id]['rows']:
            need,missing=raw[(r['moOid'],str(r['buildingIds']))]
            eq(id+': mandatory',r['plannedSubunits'],len(need));eq(id+': missing OIDs',set(r['missingUnitOids']),missing)
        eq(id+': all buildings',len(units[id]['rows']),len(raw))
        summary=next(r for r in wb['Сводный'].values if r[1]=='Республика Татарстан')
        eq(id+': federal buildings',(units[id]['fact'],units[id]['plan']),(summary[3],summary[2]))
        checks.append(dict(metric=id,source=p.name,buildings=len(raw),numerator=summary[3],denominator=summary[2],status='PASS'))
    elif family in ['tvsp_diagnostic','smp_tvsp']:
        id='tvspDiagnostic' if family=='tvsp_diagnostic' else 'smpFederal'
        rows=[r for r in wb['Факт передачи'].values if r[1]=='Республика Татарстан']
        summary=next(r for r in wb.worksheets[0].values if r[1]=='Республика Татарстан')
        eq(id+': federal',(units[id]['fact'],units[id]['plan']),(summary[3],summary[2]))
        checks.append(dict(metric=id,source=p.name,sourceRows=len(rows),numerator=summary[3],denominator=summary[2],status='PASS'))
    elif family == 'tmk_remd':
        raw={r[3]:(r[4],) for r in wb['Детализированный отчет'].values if r[1]=='Республика Татарстан'}
        record('tmkRemd',p,'Детализированный отчет',raw,read('organization-status')['tmkRemd']['rows'],['E'])
    elif family == 'elmk':
        row=next(r for r in wb['Отчет РЭМД'].values if r[0]=='Республика Татарстан')
        eq('REMD source total',read('semd-summary')['total'],row[2])
        checks.append(dict(metric='semdSummary',source=p.name,numerator=row[2],registeredTypes=row[1],status='PASS'))
        headers=list(wb['Отчет РЭМД'].values)[4]
        for id,fragment in [('37','Экстренное извещение об инфекционном'),('38','Выписка из протокола решения врачебной комиссии'),('39','Льготный рецепт')]:
            cols=[i for i,v in enumerate(headers) if (str(v)==fragment if id=='38' else fragment.casefold() in str(v).casefold())]
            assert len(cols)==1,(id,cols)
            item=next(r for r in read('federal-control')['agreement'] if r['id']==id)
            eq('agreement '+id,int(re.sub(r'\D','',item['regionalFact'])),row[cols[0]])
            checks.append(dict(metric='agreement:'+id,source=p.name,column=cols[0]+1,numerator=row[cols[0]],status='PASS'))
    wb.close()

output=dict(status='PASS',sourceCount=len(evidence['sources']),method='Independent openpyxl components; no production import adapters; MAX identity lookup uses approved registry only',checks=checks)
output['acceptedAppSha256']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'app').glob('*.json'))}
(root/'docs/update-20261102-independent-audit.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(status='PASS',checks=len(checks)),ensure_ascii=False))
