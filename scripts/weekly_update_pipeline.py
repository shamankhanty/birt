#!/usr/bin/env python3
"""Single safe entrypoint for weekly dashboard source intake.

Default is shadow mode: inventory -> classify -> period/dataset plan -> validation gate.
It never changes canonical metadata and never publishes. --apply is deliberately blocked
until an adapter can update a staging tree and all gates pass.
"""
from __future__ import annotations
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'pipeline'))
from source_catalog import scan
from staging_runner import stage
ROOT=Path(__file__).resolve().parents[1]
PROTECTED=['config/indicator-registry.json','app/mo-registry.json','STATE.md','OPEN_ISSUES.md']

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def hashes():return {x:sha(ROOT/x) for x in PROTECTED}
def main():
    ap=argparse.ArgumentParser(description='Единый безопасный конвейер еженедельного обновления')
    ap.add_argument('input',type=Path)
    ap.add_argument('--report',type=Path,default=ROOT/'validation/pipeline/latest-scan.json')
    ap.add_argument('--stage',action='store_true',help='создать staging-кандидат; канонический app/ не изменяется')
    ap.add_argument('--staging-dir',type=Path,default=ROOT/'validation/pipeline/staging-latest')
    ap.add_argument('--apply',action='store_true',help='боевое применение остаётся заблокированным до historical replay')
    ap.add_argument('--skip-refactor-gate',action='store_true')
    a=ap.parse_args(); before=hashes(); result=scan(a.input)
    result['mode']='apply-requested' if a.apply else ('staging' if a.stage else 'shadow'); result['protectedBefore']=before
    if a.stage and not a.apply:
        staged=stage(a.input,a.staging_dir)
        result['staging']={'status':staged['status'],'path':str(a.staging_dir),'changedFiles':staged.get('changedFiles',[]),'adapters':staged.get('adapters',[]),'historicalReplay':staged.get('historicalReplay')}
    else:
        result['staging']={'status':'SKIPPED'}
    if not a.skip_refactor_gate:
        p=subprocess.run(['npm','run','validate:refactor'],cwd=ROOT,text=True,capture_output=True)
        result['refactorGate']={'status':'PASS' if p.returncode==0 else 'FAIL','code':p.returncode,'stdoutTail':p.stdout[-2500:],'stderrTail':p.stderr[-1500:]}
    else: result['refactorGate']={'status':'SKIPPED'}
    after=hashes(); result['protectedAfter']=after; result['protectedChanged']=[k for k in before if before[k]!=after[k]]
    fail=result['summary']['FAIL']>0 or result['refactorGate']['status']=='FAIL' or bool(result['protectedChanged']) or result['staging']['status']=='FAIL'
    warnings=result['summary']['WARNING'] + (1 if result['staging']['status']=='WARNING' else 0)
    result['decision']='FAIL' if fail else ('WARNING' if warnings else 'PASS')
    result['aiRouting']={'send': fail, 'reason':'FAIL/методологический конфликт' if fail else 'Формальных проблем нет; ИИ не требуется'}
    if a.apply:
        result['decision']='FAIL'; result['aiRouting']={'send':True,'reason':'Запись заблокирована: live apply заблокирован до успешного real parallel replay; боевые JSON не меняются до historical replay'}
        result['applyBlocked']=True
    a.report.parent.mkdir(parents=True,exist_ok=True); a.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'decision':result['decision'],**result['summary'],'ai':result['aiRouting']['send'],'report':str(a.report)},ensure_ascii=False,indent=2))
    raise SystemExit(2 if result['decision']=='FAIL' else 0)
if __name__=='__main__':main()
