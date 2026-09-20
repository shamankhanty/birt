#!/usr/bin/env python3
"""Create a staging candidate from scanned weekly sources without touching ROOT/app."""
from __future__ import annotations
import hashlib,json,shutil,sys,subprocess,os,re
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from adapters import AdapterResult,SUPPORTED_FAMILIES,run_family,adapt_preventive,adapt_hospital,parse_iso
from source_catalog import scan

ROOT=Path(__file__).resolve().parents[2]

def sha(p:Path): return hashlib.sha256(p.read_bytes()).hexdigest()
def tree_hashes(folder:Path): return {p.relative_to(folder).as_posix():sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}

def compact_error_payload(app:Path):
    """Keep REMD category totals and MO breakdown in separate canonical JSON files."""
    categories=app/'error-categories.json'; organizations=app/'error-organizations.json'
    if not categories.exists() or not organizations.exists(): return
    payload=json.loads(categories.read_text(encoding='utf-8'))
    embedded=payload.pop('organizationBreakdown',None)
    if embedded is None: return
    separate=json.loads(organizations.read_text(encoding='utf-8'))
    if embedded!=separate:
        raise ValueError('error organization breakdown mismatch between canonical files')
    categories.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def _row_key(row:dict):
    return str(row.get('oid')) if row.get('oid') else str(row.get('name') or '').strip().lower()

def preserve_same_slice_dynamics(canonical_app:Path,staging_app:Path,target_metric:str|None=None):
    """Preserve same-cut dynamics only for the indicator in this transaction."""
    cumulative_warning='Накопительное значение уменьшилось; корректировка источника требует уточнения.'
    for name in ('mo-data.json','operational-mo.json','organization-status.json'):
        base_path=canonical_app/name; staged_path=staging_app/name
        if not base_path.exists() or not staged_path.exists(): continue
        base=json.loads(base_path.read_text(encoding='utf-8'))
        staged=json.loads(staged_path.read_text(encoding='utf-8'))
        changed=False
        for dataset_metric,new_ds in staged.items():
            if target_metric is not None and target_metric != dataset_metric:
                # Dataset keys are the indicator ids; do not touch sibling datasets.
                continue
            old_ds=base.get(dataset_metric)
            if not isinstance(new_ds,dict) or not isinstance(old_ds,dict): continue
            # A corrected methodology/source is not comparable with the prior value
            # even when the reporting cut date is identical. Do not resurrect old dynamics.
            if new_ds.get('comparisonReset'):
                continue
            if not (new_ds.get('date')==old_ds.get('date') and new_ds.get('period')==old_ds.get('period')): continue
            old_rows={_row_key(r):r for r in old_ds.get('rows',[]) if isinstance(r,dict)}
            for row in new_ds.get('rows',[]):
                old=old_rows.get(_row_key(row))
                if not old: continue
                previous=old.get('previous')
                row['previous']=previous
                fact=row.get('fact')
                same_fact=fact==old.get('fact')
                row['trend']=old.get('trend') if same_fact else (None if previous is None or fact is None else fact-previous)
                if name=='operational-mo.json':
                    if same_fact:
                        if 'sourceWarning' in old: row['sourceWarning']=old['sourceWarning']
                        else: row.pop('sourceWarning',None)
                    elif previous is not None and fact is not None and fact < previous:
                        row['sourceWarning']=cumulative_warning
                    elif row.get('sourceWarning')==cumulative_warning:
                        row.pop('sourceWarning',None)
                changed=True
        if changed:
            staged_path.write_text(json.dumps(staged,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if target_metric is not None and target_metric != 'semd228':
        return
    base_path=canonical_app/'preventive-semd-audit.json'; staged_path=staging_app/'preventive-semd-audit.json'
    if base_path.exists() and staged_path.exists():
        base=json.loads(base_path.read_text(encoding='utf-8')); staged=json.loads(staged_path.read_text(encoding='utf-8'))
        old_summary=base.get('summary',{}); new_summary=staged.get('summary',{})
        same_cut=(old_summary.get('period122')==new_summary.get('period122') and old_summary.get('period228')==new_summary.get('period228'))
        if same_cut:
            old_rows={_row_key(r):r for r in base.get('rows',[]) if isinstance(r,dict)}
            for row in staged.get('rows',[]):
                old=old_rows.get(_row_key(row))
                if not old: continue
                previous=old.get('oldShare')
                row['oldShare']=previous
                share=row.get('share')
                row['change']=old.get('change') if share==old.get('share') else (None if previous is None or share is None else share-previous)
            staged_path.write_text(json.dumps(staged,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def stage(input_dir:Path,output_dir:Path):
    from transactional_stage import stage as transactional_stage
    return transactional_stage(input_dir,output_dir)


if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('usage: staging_runner.py INPUT_DIR OUTPUT_DIR')
    result=stage(Path(sys.argv[1]),Path(sys.argv[2]));print(json.dumps({'status':result['status'],'state':result['state'],'changedFiles':result.get('changedFiles',[]),'indicators':[(a['metric'],a['state']) for a in result.get('indicators',[])]},ensure_ascii=False,indent=2));raise SystemExit(2 if result['state']=='STOP' else 0)

