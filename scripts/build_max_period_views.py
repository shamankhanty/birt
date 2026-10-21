#!/usr/bin/env python3
"""Build independent cumulative and current-month MAX views."""
from __future__ import annotations
import argparse, json, re, sys
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'/'pipeline'))
from adapters import parse_max, source_rows  # noqa: E402

def source_date(path:Path)->str:
    matches=re.findall(r"(\d{2})\.(\d{2})(?:\.(\d{4}))?",path.name)
    if len(matches)<2: raise ValueError(f"Дата не найдена в имени {path.name}")
    d,m,y=matches[1]
    return datetime(int(y or 2026),int(m),int(d)).strftime('%d.%m.%Y')
def rows(path,metric,col): return source_rows(parse_max(path,col),metric)
def total(path,col): return sum(x['count'] for x in parse_max(path,col))
def idx(items): return {x.get('oid') or x['name']:x for x in items}

def main():
    p=argparse.ArgumentParser();p.add_argument('--cumulative',type=Path,required=True);p.add_argument('--monthly-current',type=Path,required=True);p.add_argument('--monthly-previous',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'app'/'max-period-views.json');a=p.parse_args()
    targets=json.loads((ROOT/'config'/'max-targets-2026.json').read_text(encoding='utf-8'))
    month,prev='2026-10','2026-09'
    out={'month':month,'monthLabel':'Октябрь 2026','cumulative':{'date':source_date(a.cumulative),'period':'01.01–18.10.2026','source':a.cumulative.name,'metrics':{}},'operational':{'date':source_date(a.monthly_current),'period':'01.10–21.10.2026','previousDate':source_date(a.monthly_previous),'previousPeriod':'01.10–19.10.2026','source':a.monthly_current.name,'previousSource':a.monthly_previous.name,'metrics':{}},'methodology':{'monthlyPlan':'Разница соседних накопительных контрольных точек утверждённого плана','missing':'Отсутствие строки не заменяется нулём','forecast':'Текущий факт плюс темп между двумя последними месячными выгрузками до конца месяца'}}
    for service,(metric,col) in {'tmk':('tmkMaxCount',3),'eln':('elnMaxCount',4)}.items():
        ci,mi,pi=idx(rows(a.cumulative,metric,col)),idx(rows(a.monthly_current,metric,col)),idx(rows(a.monthly_previous,metric,col)); cr=[]; mr=[]
        for oid,t in targets['organizationPlans'].items():
            c,m,pv=ci.get(oid),mi.get(oid),pi.get(oid); cp=t[service][month]; mp=cp-t[service][prev]
            cr.append({'name':t['name'],'oid':oid,'fact':c.get('fact') if c else None,'plan':cp})
            mr.append({'name':t['name'],'oid':oid,'fact':m.get('fact') if m else None,'previous':pv.get('fact') if pv else None,'plan':mp})
        out['cumulative']['metrics'][service]={'sourceTotal':total(a.cumulative,col),'plannedMoFact':sum(x['fact'] for x in cr if x['fact'] is not None),'republicPlan':targets['republic'][service][month],'rows':cr}
        out['operational']['metrics'][service]={'sourceTotal':total(a.monthly_current,col),'previousSourceTotal':total(a.monthly_previous,col),'plannedMoFact':sum(x['fact'] for x in mr if x['fact'] is not None),'previousPlannedMoFact':sum(x['previous'] for x in mr if x['previous'] is not None),'republicPlan':targets['republic'][service][month]-targets['republic'][service][prev],'rows':mr}
    a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__': main()
