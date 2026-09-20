#!/usr/bin/env python3
from __future__ import annotations
import json,re,calendar,zipfile
from collections import Counter
from dataclasses import dataclass,asdict
from datetime import date
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
CONFIG=ROOT/'config/import-pipeline.json'
MONTHS={'январ':1,'феврал':2,'март':3,'апрел':4,'май':5,'мая':5,'июн':6,'июл':7,'август':8,'сентябр':9,'октябр':10,'ноябр':11,'декабр':12}

def baseline_year():
    try:
        payload=json.loads((ROOT/'baseline/period-engine-snapshot.json').read_text(encoding='utf-8'))
        return int(payload['latestFullMonth']['endDate'].split('.')[-1])
    except Exception:
        return 2026

def short_range_end(text:str):
    year=baseline_year()
    # 31_08_06_09 / 31.08-06.09: start day/month + end day/month, no year.
    patterns=[
        r'(?<!\d)(\d{1,2})[._](\d{1,2})[_-](\d{1,2})[._](\d{1,2})(?![._-]\d)',
        r'(?<!\d)(\d{1,2})[._](\d{1,2})\s*[-–]\s*(\d{1,2})[._](\d{1,2})(?![._-]\d)',
    ]
    for pattern in patterns:
        m=re.search(pattern,text)
        if not m: continue
        sd,sm,ed,em=map(int,m.groups())
        end_year=year + (1 if em < sm else 0)
        try: return date(end_year,em,ed)
        except ValueError: return None
    return None

@dataclass
class Item:
    path:str; name:str; family:str|None; status:str; adapter:str|None; datasets:list[str]; periodKind:str|None; endDate:str|None; matches:list[str]; integrity:str
    startDate:str|None=None
    recognition:str='filename'
    reason:str|None=None

def load_config(): return json.loads(CONFIG.read_text(encoding='utf-8'))
def parse_dates(text:str):
    out=[]
    for d,m,y in re.findall(r'(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](20\d{2})(?!\d)',text):
        try: out.append(date(int(y),int(m),int(d)))
        except ValueError: pass
    for d,m,y2 in re.findall(r'(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](\d{2})(?!\d)',text):
        try: out.append(date(2000+int(y2),int(m),int(d)))
        except ValueError: pass
    return out

def month_hint(text:str,year=2026):
    t=text.casefold()
    hits=[]
    for stem,m in MONTHS.items():
        if stem in t: hits.append(m)
    if not hits:return None
    ym=re.findall(r'20\d{2}',t); y=int(ym[-1]) if ym else year
    return date(y,hits[-1],calendar.monthrange(y,hits[-1])[1])

def infer_end(path:Path):
    short=short_range_end(path.name)
    if short:return short
    ds=parse_dates(path.name)
    if ds:return max(ds)
    # Cumulative ranges without a year, e.g. 01.01.-17.09.
    # Use the baseline year; do not borrow a date from another source file.
    ranges=re.findall(r'(?<!\d)(\d{1,2})[._](\d{1,2})[._]?\s*[-–]\s*(\d{1,2})[._](\d{1,2})[.]?(?![_-]?\d)',path.name)
    if ranges:
        _,_,ed,em=map(int,ranges[-1])
        try:return date(baseline_year(),em,ed)
        except ValueError:pass
    ds=parse_dates(str(path.parent))
    if ds:return max(ds)
    return month_hint(path.name+' '+path.parent.name)


def integrity(path:Path):
    if not path.exists(): return 'UNAVAILABLE'
    try:
        if path.suffix.lower()=='.xlsx': return 'PASS' if zipfile.is_zipfile(path) else 'FAIL'
        if path.suffix.lower()=='.xls':
            return 'PASS' if path.read_bytes()[:8]==bytes.fromhex('D0CF11E0A1B11AE1') else 'FAIL'
        if path.suffix.lower()=='.csv': return 'PASS' if path.stat().st_size>0 else 'FAIL'
    except OSError:return 'FAIL'
    return 'PASS'

def classify(path:Path,cfg=None):
    cfg=cfg or load_config(); hits=[]
    for fam in cfg['families']:
        if any(re.search(p,path.name,re.I) for p in fam['patterns']): hits.append(fam)
    end=infer_end(path); integ=integrity(path)
    structure={}
    if path.exists() and path.suffix.lower()=='.xlsx' and integ=='PASS':
        try:
            from excel_structure import inspect_workbook
            structure=inspect_workbook(path)
        except Exception as exc:
            integ='FAIL'; structure={'error':f'Excel: {exc}'}
        if structure.get('family'):
            structural=[f for f in cfg['families'] if f['id']==structure['family']]
            if hits and hits[0]['id']!=structure['family']:
                structure['error']='Название файла противоречит структуре книги'
            hits=structural
        if structure.get('endDate'): end=date.fromisoformat(structure['endDate'])
    start=structure.get('startDate')
    if not start:
        match=re.search(r'(?<!\d)(\d{2})[._](\d{2})[.]?(?:20\d{2})?\s*[-–]',path.name)
        if match and end:
            try:start=date(end.year,int(match[2]),int(match[1])).isoformat()
            except ValueError:pass
    extra={'startDate':start,'recognition':'structure' if structure.get('family') else 'filename','reason':structure.get('error') or structure.get('reason')}
    if len(hits)==1:
        f=hits[0]; status='FAIL' if integ=='FAIL' or structure.get('error') else 'PASS'; return Item(str(path),path.name,f['id'],status,f['adapter'],f['datasets'],f['periodKind'],end.isoformat() if end else None,[f['id']],integ,**extra)
    if len(hits)>1:return Item(str(path),path.name,None,'FAIL',None,[],None,end.isoformat() if end else None,[x['id'] for x in hits],integ)
    status='FAIL' if integ=='FAIL' else cfg['unknownFileStatus']; return Item(str(path),path.name,None,status,None,[],None,end.isoformat() if end else None,[],integ,**extra)

def scan(folder:Path):
    cfg=load_config(); files=sorted([p for p in folder.rglob('*') if p.is_file() and not p.name.startswith('~$') and p.suffix.lower() in {'.xlsx','.xls','.csv'}]); items=[classify(p,cfg) for p in files]
    dup=[]; seen={}
    for i in items:
        if not i.family:continue
        key=(i.family,i.endDate)
        if key in seen:
            first=seen[key]
            if i.family=='max_tmk_eln':
                first_cumulative=bool(first.startDate and first.startDate.endswith('-01-01'))
                current_cumulative=bool(i.startDate and i.startDate.endswith('-01-01'))
                if first_cumulative != current_cumulative:
                    # MAX: cumulative 01.01?cutoff is the canonical import.
                    # A month-only file for the same cutoff is supplementary/control data.
                    control=i if first_cumulative else first
                    canonical=first if first_cumulative else i
                    control.status='WARNING'
                    seen[key]=canonical
                    continue
            dup.append({'family':i.family,'endDate':i.endDate,'files':[first.name,i.name]}); i.status='FAIL'; first.status='FAIL'
        else:seen[key]=i
    statuses=Counter(x.status for x in items)
    ends=[date.fromisoformat(x.endDate) for x in items if x.endDate and x.status!='FAIL']
    inferred=max(ends).isoformat() if ends else None
    full_ends=[d for d in ends if d.day==calendar.monthrange(d.year,d.month)[1]]
    input_full=max(full_ends) if full_ends else None
    baseline=json.loads((ROOT/'baseline/period-engine-snapshot.json').read_text(encoding='utf-8'))
    bday,bmonth,byear=map(int,baseline['latestFullMonth']['endDate'].split('.'))
    baseline_full=date(byear,bmonth,bday)
    effective=max([d for d in [baseline_full,input_full] if d])
    previous_month=effective.month-1 or 12; previous_year=effective.year if effective.month>1 else effective.year-1
    previous_end=date(previous_year,previous_month,calendar.monthrange(previous_year,previous_month)[1])
    datasets=sorted({d for x in items if x.status!='FAIL' for d in x.datasets})
    return {'schemaVersion':1,'input':str(folder),'summary':{'files':len(items),'PASS':statuses['PASS'],'WARNING':statuses['WARNING'],'FAIL':statuses['FAIL'],'inferredLatestDate':inferred,'inputLatestFullMonthEnd':input_full.isoformat() if input_full else None,'effectiveLatestFullMonthEnd':effective.isoformat(),'previousComparableMonthEnd':previous_end.isoformat(),'hasPartialNewerMonth':bool(ends and max(ends)>effective),'datasetsToRefresh':datasets},'duplicates':dup,'files':[asdict(x) for x in items]}
