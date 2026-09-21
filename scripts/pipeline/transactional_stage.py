"""Isolated per-indicator candidates. Failed transactions never reach the final tree."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

from adapters import (SPECIALTIES, adapt_egpu, adapt_max, adapt_short_input,
                      adapt_physicians, adapt_preventive, adapt_hospital, run_family, parse_iso)
from adapters import parse_max, source_rows
from source_catalog import scan
from replay_gate import run as compare_trees

ROOT = Path(__file__).resolve().parents[2]
METRICS = {
    'egpu_attachment': ['egpu', 'egpu2days'], 'hospital_cases': ['hospital'],
    'ambulatory_cases': ['ambulatoryCase'], 'preventive_remd': ['semd228'],
    'birth_certificates': ['birth'], 'death_certificates': ['death'],
    'max_tmk_eln': ['tmkMaxCount', 'elnMaxCount'],
    'physicians': ['doctorsAll', 'doctorsLevel3', *SPECIALTIES.values()],
    'remd_errors': ['remdErrors'], 'electronic_waybill': ['electronicWaybill'],
    'tvsp_ambulatory': ['tvspAmbulatory'], 'tvsp_stationary': ['tvspStationary'],
    'tvsp_laboratory': ['tvspLaboratory'], 'tvsp_diagnostic': ['tvspDiagnostic'],
    'smp_tvsp': ['smpFederal'], 'tmk_remd': ['tmkRemd'], 'elmk': ['elmk'],
    'short_input': ['shortInput', 'shortInputAmb', 'shortInputHosp'],
    'fap_fp': ['fapSemdCount'], 'asu_smp': ['smp'],
}
MAPS = ['mo-data.json', 'operational-mo.json', 'organization-status.json',
        'mo-details.json', 'mo-detail-oids.json', 'monthly-mo.json', 'unit-data.json']


class SystemicError(Exception):
    """The validation infrastructure cannot establish a safe candidate."""


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def hashes(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob('*')) if p.is_file()}


def validate(app, output):
    output.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'DASHBOARD_APP_DIR': str(app), 'DASHBOARD_VALIDATION_DIR': str(output)}
    result = subprocess.run(['node', str(ROOT/'scripts/run-validation.mjs')], cwd=ROOT,
                            env=env, capture_output=True, text=True, encoding='utf-8')
    (output/'console.log').write_text(result.stdout+'\n'+result.stderr, encoding='utf-8')
    report_path = output/'validation-report.json'
    if not report_path.exists(): raise SystemicError('Валидатор не создал отчет: '+result.stderr[-500:])
    report = read(report_path)
    if result.returncode and report['overallStatus'] != 'FAIL': raise SystemicError('Аварийное завершение валидатора')
    return report


def gate_errors(report):
    return [f"{c['id']}: {i.get('organizationName', '')} {i.get('kind', '')}"
            for c in report['checks'] if c['status']=='FAIL' for i in c.get('issues', []) if i.get('status')=='FAIL']


def period_metadata(app, metric):
    if metric=='remdErrors':
        data=read(app/'error-categories.json'); return {'date':data.get('shareDate'),'period':data.get('period')}
    if metric=='electronicWaybill':
        data=read(app/'electronic-waybill-weekly.json'); return {'period':data.get('current',{}).get('period') or data.get('currentPeriod') or data.get('period')}
    for filename in MAPS[:3]:
        ds=read(app/filename).get(metric)
        if ds: return {k:ds.get(k) for k in ('date','period')}
    weekly=read(app/'physician-weekly-snapshot.json') if (app/'physician-weekly-snapshot.json').exists() else {}
    if metric in weekly.get('datasets',{}):
        return weekly.get('periods',{}).get(metric,{k:weekly.get(k) for k in ('date','period')})
    return {}


def metric_label(app,metric):
    labels={'remdErrors':'Ошибки регистрации СЭМД','electronicWaybill':'Электронный путевой лист'}
    if metric in labels: return labels[metric]
    for filename in MAPS[:3]+['physician-metrics.json']:
        if not (app/filename).exists(): continue
        data=read(app/filename)
        ds=data.get('datasets',data).get(metric,{})
        if ds.get('name'): return ds['name']
    return metric


def indicator_statistics(indicators):
    received=[item for item in indicators if item['sources']]
    return {
        'expectedIndicators':len(indicators),
        'receivedIndicators':len(received),
        'preparedIndicators':sum(item['state']=='PREPARED' for item in received),
        'unchangedIndicators':sum(item['state']=='UNCHANGED' for item in received),
        'retainedInvalidIndicators':sum(item['state']=='RETAINED' for item in received),
        'missingSourceIndicators':len(indicators)-len(received),
    }


def invoke(app, family, metric, item, partner):
    source, end = Path(item['path']), parse_iso(item['endDate'])
    if not end: raise ValueError('Не установлен отчетный период источника')
    start=item.get('startDate')
    if family not in ('physicians','electronic_waybill','remd_errors') and start and not start.endswith('-01-01'):
        raise ValueError('Источник не накопительный с 01.01; прежний накопительный показатель сохранен')
    if family=='max_tmk_eln' and not start:
        raise ValueError('MAX: не подтверждено начало накопительного периода 01.01')
    if family=='max_tmk_eln' and item.get('controls'):
        col=3 if metric=='tmkMaxCount' else 4
        cumulative={r.get('oid') or r['name']:r['count'] for r in source_rows(parse_max(source,col),metric)}
        for control in item['controls']:
            if control['status']=='FAIL': raise ValueError('MAX: контрольный источник поврежден или неоднозначен')
            for row in source_rows(parse_max(Path(control['path']),col),metric):
                key=row.get('oid') or row['name']
                if key not in cumulative or row['count']>cumulative[key]:
                    raise ValueError(f'MAX: месячный контроль превышает накопительный или МО отсутствует: {row["name"]}')
    if family=='remd_errors' and start:
        if (end-parse_iso(start)).days != 6:
            raise ValueError('Выгрузка отказов не за полную неделю; накопительные отказы не заменяют недельный срез')
    if family=='egpu_attachment': return adapt_egpu(app,source,end,metric)
    if family=='max_tmk_eln': return adapt_max(app,source,end,metric)
    if family=='short_input': return adapt_short_input(app,source,end,metric)
    if family=='physicians': return adapt_physicians(app,source,end,ROOT/'app/mo-registry.json',metric)
    if family=='preventive_remd':
        if not partner or partner['status']=='FAIL' or partner['endDate']!=item['endDate'] or partner.get('startDate')!=start:
            raise ValueError('Нет парного источника за тот же отчетный период')
        return adapt_preventive(app,source,Path(partner['path']),end,ROOT/'app/mo-registry.json')
    if family=='hospital_cases': return adapt_hospital(app,source,end)
    return run_family(app,family,source,end,ROOT)


def project_metric(current, generated, metric, item):
    """Copy only the target indicator's JSON subtrees, never sibling indicators."""
    for filename in MAPS:
        old,new=read(current/filename),read(generated/filename)
        if metric in new and new.get(metric)!=old.get(metric):
            old[metric]=new[metric]
            write(generated/filename,old)
        else: shutil.copy2(current/filename,generated/filename)
    # Weekly physician values have independent dates, including failed siblings.
    if item['family']=='physicians':
        phys_name='physician-metrics.json'
        old_phys,new_phys=read(current/phys_name),read(generated/phys_name)
        if metric in new_phys['datasets']:
            old_phys['datasets'][metric]=new_phys['datasets'][metric]
        write(generated/phys_name,old_phys)
        path=generated/'physician-weekly-snapshot.json'
        old=read(current/path.name) if (current/path.name).exists() else {}
        new=read(path) if path.exists() else {}
        if metric in new.get('datasets',{}):
            merged=copy.deepcopy(old)
            previous_period=old.get('periods',{}).get(metric,{k:old.get(k) for k in ('date','period','source')})
            new_date=parse_iso(item['endDate']).strftime('%d.%m.%Y')
            if previous_period.get('date')!=new_date:
                merged.setdefault('previousPeriods',{})[metric]=previous_period
                for field in ('Datasets','Summary'):
                    if metric in old.get(field.lower(),{}):
                        merged.setdefault('previous'+field,{})[metric]=old[field.lower()][metric]
            for field in ('datasets','summary'):
                merged.setdefault(field,{})[metric]=new[field][metric]
            merged.setdefault('periods',{})[metric]={
                'date':new_date, 'period':f"{parse_iso(item['startDate']).strftime('%d.%m.%Y') if item.get('startDate') else '?'}–{new_date}", 'source':item['name']}
            # Keep top-level metadata aligned with the source accepted for this
            # transaction.  Previously these fields stayed from production,
            # while the new 500+ values were stored under per-metric periods.
            merged['date'] = new_date
            merged['period'] = merged['periods'][metric]['period']
            merged['source'] = item['name']
            # Global metadata remains explicitly mixed; individual periods are authoritative.
            merged['mixedPeriods']=True
            write(path,merged)


def historical_replay(output, manifest_path=None):
    """Only independent, source-backed expected artifacts can establish historical PASS."""
    if not manifest_path or not Path(manifest_path).is_file():
        result={'status':'UNAVAILABLE','reason':'В ARCHIVE нет подтвержденного historical-replay.json с исходниками и эталоном. Публикация заблокирована.'}
    else:
        manifest=read(Path(manifest_path)); cases=[]
        # Qualify this implementation once. Reuse the proof only while its code,
        # rules, baseline, reference artifacts and source bytes still match.
        implementation_root=Path(__file__).resolve().parents[2]
        evidence={'manifest':manifest,'implementation':{},'cases':[]}
        for folder in ('scripts/pipeline','lib','config'):
            for path in sorted((implementation_root/folder).rglob('*')):
                if path.is_file() and path.suffix in ('.py','.js','.mjs','.json'):
                    evidence['implementation'][path.relative_to(implementation_root).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
        for name in ('app/mo-registry.json','baseline/manifest.json','STATE.md'):
            evidence['implementation'][name]=hashlib.sha256((implementation_root/name).read_bytes()).hexdigest()
        for case in manifest.get('cases',[]):
            source_paths=[Path(case['source']['path'])]
            if case.get('partner'): source_paths.append(Path(case['partner']['path']))
            evidence['cases'].append({'baseline':hashes(Path(case['baselineApp'])),
                'expected':hashes(Path(case['expectedApp'])),
                'sources':{str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths}})
        fingerprint=hashlib.sha256(json.dumps(evidence,sort_keys=True).encode('utf-8')).hexdigest()
        receipt_path=ROOT/'REPORTS/historical-qualification.json'
        if receipt_path.is_file():
            try: receipt=read(receipt_path)
            except (ValueError,OSError): receipt={}
            if receipt.get('fingerprint')==fingerprint and receipt.get('result',{}).get('status')=='PASS':
                result={**receipt['result'],'reusedQualification':True}
                write(output/'historical-replay.json',result)
                return result
        for case in manifest.get('cases',[]):
            if not case.get('files'): raise ValueError('Historical replay: не указан перечень проверяемых файлов')
            baseline=Path(case['baselineApp']); source=case['source']; metric=case['metric']
            source_path=Path(source['path'])
            if hashlib.sha256(source_path.read_bytes()).hexdigest()!=case['sourceSha256']:
                raise RuntimeError('Historical replay: хеш источника не совпадает')
            target=output/('case-'+str(len(cases)))
            shutil.copytree(baseline,target)
            invoke(target,source['family'],metric,source,case.get('partner'))
            result_case=compare_trees(Path(case['expectedApp']),target,case['files'])
            cases.append({'metric':metric,**result_case})
        result={'status':'PASS' if cases and all(c['status']=='PASS' for c in cases) else 'FAIL','cases':cases}
        if result['status']=='PASS':
            write(receipt_path,{'schemaVersion':1,'fingerprint':fingerprint,
                'origin':str(Path(manifest_path).resolve()),'result':result,'evidence':evidence})
    write(output/'historical-replay.json',result)
    return result


def stage(input_dir, output_dir, replay_manifest=None):
    from staging_runner import compact_error_payload, preserve_same_slice_dynamics
    input_dir,output_dir=Path(input_dir).resolve(),Path(output_dir).resolve()
    if output_dir.exists(): raise ValueError('Каталог кандидата уже существует; требуется новый каталог запуска')
    production=ROOT/'app'; before=hashes(production)
    output_dir.mkdir(parents=True)
    current=output_dir/'app'; shutil.copytree(production,current)
    intake=scan(input_dir); write(output_dir/'intake.json',intake)
    baseline_gate=validate(current,output_dir/'baseline-validation')
    if baseline_gate['overallStatus']=='FAIL':
        raise RuntimeError('Production baseline не проходит проверки: '+ '; '.join(gate_errors(baseline_gate)[:5]))
    for gate in ('run-calculation-equivalence.mjs','run-indicator-metadata-equivalence.mjs'):
        check=subprocess.run(['node',str(ROOT/'scripts'/gate)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',
                             env={**os.environ,'DASHBOARD_VALIDATION_DIR':str(output_dir/'baseline-validation')})
        (output_dir/'baseline-validation'/f'{gate}.log').write_text(check.stdout+'\n'+check.stderr,encoding='utf-8')
        if check.returncode: raise RuntimeError(f'Не пройдена защитная проверка {gate}')
    by={}
    for item in intake['files']:
        if item['family']: by.setdefault(item['family'],[]).append(item)
    results=[]
    def latest(family):
        items=by.get(family,[])
        if family=='max_tmk_eln': items=[i for i in items if (i.get('startDate') or '').endswith('-01-01')]
        selected=max(items,key=lambda i:i.get('endDate') or '') if items else None
        if selected and family=='max_tmk_eln':
            selected={**selected,'controls':[i for i in by[family] if i.get('startDate') and not i['startDate'].endswith('-01-01') and i['endDate']==selected['endDate']]}
        return selected
    for family,metrics in METRICS.items():
        item=latest(family)
        partner=latest('preventive_foms') if family=='preventive_remd' else None
        received=by.get(family,[])
        if family=='preventive_remd': received=received+by.get('preventive_foms',[])
        for metric in metrics:
            entry={'metric':metric,'label':metric_label(production,metric),'family':family,'state':'RETAINED','previousPeriod':period_metadata(production,metric),'sources':[source['name'] for source in received],'errors':[]}
            if not item:
                entry['errors']=['Нет подходящего основного источника (накопительного/парного)' if received else 'Нет входного источника показателя']; results.append(entry); continue
            tx=output_dir/'transactions'/metric; raw=tx/'app'; shutil.copytree(current,raw)
            try:
                if item['status']=='FAIL': raise ValueError(item.get('reason') or 'Источник поврежден или дублирует период')
                prior=entry['previousPeriod'].get('date')
                if prior:
                    from datetime import datetime
                    old_date=datetime.strptime(prior,'%d.%m.%Y').date() if '.' in prior else parse_iso(prior)
                    if item.get('endDate') and parse_iso(item['endDate'])<old_date:
                        raise ValueError('Источник старше действующего периода; прежний показатель сохранен')
                result=invoke(raw,family,metric,item,partner)
                if result.status=='FAIL' or result.errors: raise ValueError('; '.join(result.errors))
                compact_error_payload(raw)
                preserve_same_slice_dynamics(current,raw,metric)
                project_metric(current,raw,metric,item)
                validation=validate(raw,tx/'validation')
                if validation['overallStatus']=='FAIL': raise ValueError('; '.join(gate_errors(validation)))
                # Deterministic repeat from exactly the same accepted baseline.
                replay=tx/'repeat'; shutil.copytree(current,replay)
                invoke(replay,family,metric,item,partner)
                compact_error_payload(replay); preserve_same_slice_dynamics(current,replay,metric)
                project_metric(current,replay,metric,item)
                accepted_hashes=hashes(current)
                changed=[name for name,value in hashes(raw).items() if accepted_hashes.get(name)!=value]
                replay_result=compare_trees(raw,replay,[n for n in changed if n.endswith('.json')])
                write(tx/'repeatability.json',replay_result)
                if replay_result['status']!='PASS': raise ValueError('Повторная обработка дала другой результат')
                # Commit to the unpublished candidate only after every gate passes.
                for name in changed: shutil.copy2(raw/name,current/name)
                entry.update(state='PREPARED' if changed else 'UNCHANGED',changedFiles=changed,
                             period=period_metadata(current,metric),warnings=result.warnings,facts=result.facts,
                             repeatability=replay_result['status'])
            except (ValueError,KeyError,IndexError,TypeError,RuntimeError) as error:
                entry['errors']=[str(error)]
            results.append(entry)
            write(tx/'transaction.json',entry)
    formal=validate(current,output_dir/'validation')
    if formal['overallStatus']=='FAIL': raise RuntimeError('Итоговая проверка кандидата не пройдена')
    if hashes(production)!=before: raise RuntimeError('Production изменился во время сборки кандидата')
    try:
        historical=historical_replay(output_dir/'replay',replay_manifest)
    except (ValueError,KeyError,RuntimeError,OSError) as error:
        historical={'status':'FAIL','reason':str(error)}
        write(output_dir/'replay/historical-replay.json',historical)
    unknown=[i for i in intake['files'] if not i['family']]
    active_retained=[r for r in results if r['state']=='RETAINED' and r['sources']]
    covered={c['metric'] for c in historical.get('cases',[]) if c['status']=='PASS'}
    prepared={r['metric'] for r in results if r['state']=='PREPARED'}
    historical['unverifiedMetrics']=sorted(prepared-covered)
    state='PARTIAL' if active_retained or unknown or historical['status']!='PASS' or prepared-covered or not intake['files'] else 'READY'
    changed=sorted(n for n,v in hashes(current).items() if before.get(n)!=v)
    manifest={'schemaVersion':2,'state':state,'status':'WARNING' if state=='PARTIAL' else 'PASS',
              'statistics':indicator_statistics(results),
              'sourceCount':len(intake['files']),'indicators':results,'unknownSources':unknown,
              'changedFiles':changed,'canonicalAppChanged':False,'stagingApp':str(current),
              'formalValidation':{'status':formal['overallStatus'],'summary':formal['summary']},
              'historicalReplay':historical,'publicationAllowed':False,'adapters':results}
    write(output_dir/'staging-manifest.json',manifest)
    return manifest
