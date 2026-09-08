#!/usr/bin/env python3
"""Create a staging candidate from scanned weekly sources without touching ROOT/app."""
from __future__ import annotations
import hashlib,json,shutil,sys,subprocess,os
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from adapters import AdapterResult,SUPPORTED_FAMILIES,run_family,adapt_preventive,parse_iso
from source_catalog import scan

ROOT=Path(__file__).resolve().parents[2]

def sha(p:Path): return hashlib.sha256(p.read_bytes()).hexdigest()
def tree_hashes(folder:Path): return {p.relative_to(folder).as_posix():sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}

def stage(input_dir:Path,output_dir:Path):
    intake=scan(input_dir)
    if intake['summary']['FAIL']:
        return {'status':'FAIL','reason':'intake-fail','intake':intake,'adapters':[]}
    if output_dir.exists(): shutil.rmtree(output_dir)
    (output_dir/'app').parent.mkdir(parents=True,exist_ok=True);shutil.copytree(ROOT/'app',output_dir/'app')
    before=tree_hashes(output_dir/'app'); by=defaultdict(list)
    for item in intake['files']:
        if item['family'] and item['status']!='FAIL': by[item['family']].append(item)
    results=[]; consumed=set()
    # paired preventive source must have same end date
    if by.get('preventive_remd') or by.get('preventive_foms'):
        r=max(by.get('preventive_remd',[]),key=lambda x:x.get('endDate') or '') if by.get('preventive_remd') else None
        f=max(by.get('preventive_foms',[]),key=lambda x:x.get('endDate') or '') if by.get('preventive_foms') else None
        if not r or not f or r.get('endDate')!=f.get('endDate'):
            results.append(AdapterResult('preventive_pair',['preventive_remd','preventive_foms'],'FAIL',[],[x['name'] for x in [r,f] if x],{},[],['Нужны оба файла 122/228 и ФОМС за один период']).dict())
        else:
            try: results.append(adapt_preventive(output_dir/'app',Path(r['path']),Path(f['path']),parse_iso(r['endDate']),ROOT/'app/mo-registry.json').dict())
            except Exception as e: results.append(AdapterResult('preventive_pair',['preventive_remd','preventive_foms'],'FAIL',[],[r['name'],f['name']],{},[],[str(e)]).dict())
        consumed|={'preventive_remd','preventive_foms'}
    for family,items in sorted(by.items()):
        if family in consumed:continue
        latest=max(items,key=lambda x:x.get('endDate') or '')
        if family not in SUPPORTED_FAMILIES:
            results.append(AdapterResult(latest.get('adapter') or 'unknown',[family],'WARNING',[],[latest['name']],{},['Adapter отсутствует в staging; reference script сохранён'],[]).dict());continue
        try: results.append(run_family(output_dir/'app',family,Path(latest['path']),parse_iso(latest['endDate']),ROOT).dict())
        except Exception as e: results.append(AdapterResult(latest.get('adapter') or family,[family],'FAIL',[],[latest['name']],{},[],[str(e)]).dict())
    after=tree_hashes(output_dir/'app'); changed=sorted(k for k in set(before)|set(after) if before.get(k)!=after.get(k))
    fail=any(x['status']=='FAIL' for x in results); warning=any(x['status']=='WARNING' for x in results)
    validation_dir=output_dir/'validation'
    env=os.environ.copy();env['DASHBOARD_APP_DIR']=str(output_dir/'app');env['DASHBOARD_VALIDATION_DIR']=str(validation_dir)
    vp=subprocess.run(['node','scripts/run-validation.mjs'],cwd=ROOT,text=True,capture_output=True,env=env)
    validation_report=None
    vr=validation_dir/'validation-report.json'
    if vr.exists(): validation_report=json.loads(vr.read_text(encoding='utf-8'))
    formal_status=(validation_report or {}).get('overallStatus','FAIL' if vp.returncode else 'PASS')
    fail=fail or formal_status=='FAIL'; warning=warning or formal_status=='WARNING'
    manifest={'schemaVersion':1,'status':'FAIL' if fail else ('WARNING' if warning else 'PASS'),'input':str(input_dir),'stagingApp':str(output_dir/'app'),'intake':intake['summary'],'adapters':results,'changedFiles':changed,'canonicalAppChanged':False,'formalValidation':{'status':formal_status,'code':vp.returncode,'summary':(validation_report or {}).get('summary'),'report':str(vr),'stdoutTail':vp.stdout[-1600:],'stderrTail':vp.stderr[-800:]},'historicalReplay':{'status':'PENDING_INPUTS','reason':'Исходные historical Excel отсутствуют в переданном ZIP; replay-gate закроется на реальных входных файлах.'}}
    output_dir.mkdir(parents=True,exist_ok=True);(output_dir/'staging-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return manifest

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('usage: staging_runner.py INPUT_DIR OUTPUT_DIR')
    result=stage(Path(sys.argv[1]),Path(sys.argv[2]));print(json.dumps({'status':result['status'],'changedFiles':result.get('changedFiles',[]),'adapters':[(a['families'],a['status']) for a in result.get('adapters',[])]},ensure_ascii=False,indent=2));raise SystemExit(2 if result['status']=='FAIL' else 0)
