#!/usr/bin/env python3
"""Load two complete 2026 periods: July and August.

Monthly physician reports are compared month-to-month. All other reports in
these archives are cumulative cuts and are labelled as such. The script keeps
the original source files untouched and writes only dashboard JSON.
"""
from __future__ import annotations

import json, re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
JUL = Path("/workspace/scratch/1f5740e14d75/analysis_jan_jul/Выгрузки Январь - Июль")
AUG = Path("/workspace/scratch/1f5740e14d75/analysis_jan_aug")

def one(root: Path, prefix: str) -> Path:
    found = list(root.glob(prefix + "*"))
    if len(found) != 1: raise RuntimeError(f"{prefix}: expected one file, got {found}")
    return found[0]
def load(name): return json.loads((APP/name).read_text(encoding="utf-8"))
def save(name,data): (APP/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def n(v):
    try: return int(float(v or 0))
    except: return 0
def norm(v):
    v=str(v or '').lower().replace('ё','е'); v=re.sub(r'["«»]','',v)
    v=re.sub(r'^(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во|ао|ооо)(?:\s+рт)?\s+','',v)
    return re.sub(r'[^а-яa-z0-9№]+',' ',v).strip()
def monthly_rows(prev,cur,unit='%'):
    p={(str(x.get('oid')) if x.get('oid') else norm(x['name'])):x for x in prev}
    out=[]
    for x in cur:
        k=str(x.get('oid')) if x.get('oid') else norm(x['name']); old=p.get(k)
        pv=old.get('fact') if old else None
        out.append({'name':x['name'],'june':pv,'july':x.get('fact'),'change':None if pv is None else x.get('fact')-pv,
                    'juneQuantity':None if not old else old.get('quantity'), 'julyQuantity':x.get('quantity')})
    return {'unit':unit,'previousLabel':'На 31.07','currentLabel':'На 31.08','rows':out}

mo=load('mo-data.json'); details=load('mo-details.json'); oids=load('mo-detail-oids.json')
monthly=load('monthly-mo.json'); operational=load('operational-mo.json')

def parse_egpu(root, col):
    ws=openpyxl.load_workbook(one(root,'ПР_2_'),read_only=True,data_only=True)['Отчет']; out=[]
    for r in ws.iter_rows(min_row=4,values_only=True):
        if not r[2]: continue
        den=n(r[4]); num=n(r[col]); out.append({'name':str(r[2]),'oid':str(r[3]),'fact':num/den*100 if den else 0,'count':num,'volume':den,'quantity':f'{num:,} / {den:,}'.replace(',',' ')})
    return out
for metric,col,plan,title in [('egpu',5,100,'Доля заявлений на прикрепление с финальным статусом'),('egpu2days',6,90,'Доля заявлений на прикрепление, рассмотренных за 2 рабочих дня')]:
    p,c=parse_egpu(JUL,col),parse_egpu(AUG,col); pm={x['oid']:x for x in p}
    rows=[]; dn={}; do={}
    for x in c:
        old=pm.get(x['oid']); x['previous']=old['fact'] if old else None; x['trend']=None if not old else x['fact']-old['fact']; x.pop('quantity'); rows.append(x)
        d={'volume':x.pop('volume'),'registered':x['count']}; dn[norm(x['name'])]=d; do[x['oid']]=d
    mo[metric]={'name':title,'plan':plan,'unit':'%','date':'31.08.2026','period':'01.01–31.08.2026','note':'Полный накопительный срез. Сравнение: 01.01–31.07 и 01.01–31.08. Производные отрицательные столбцы источника не используются.','rows':rows}
    details[metric]=dn; oids[metric]=do; monthly[metric]=monthly_rows(p,c)

def parse_hospital(root):
    ws=openpyxl.load_workbook(one(root,'Отчет_по_госпитализациям'),read_only=True,data_only=True)['Лист3']; out=[]
    for r in ws.iter_rows(min_row=6,values_only=True):
        if not r[1] or not r[2]: continue
        den=n(r[3]); num=n(r[4])+n(r[5]); out.append({'name':str(r[1]),'oid':str(r[2]),'fact':num/den*100 if den else 0,'count':num,'volume':den,'quantity':f'{num:,} / {den:,}'.replace(',',' ')})
    return out
p,c=parse_hospital(JUL),parse_hospital(AUG); pm={x['oid']:x for x in p}; rows=[];dn={};do={}
for x in c:
    old=pm.get(x['oid']); x['previous']=old['fact'] if old else None;x['trend']=None if not old else x['fact']-old['fact'];x.pop('quantity');rows.append(x)
    d={'volume':x.pop('volume'),'registered':x['count']};dn[norm(x['name'])]=d;do[x['oid']]=d
mo['hospital']={**mo['hospital'],'date':'31.08.2026','period':'01.01–31.08.2026','note':'Полный накопительный срез. Знаменатель — лист 3: все закрытые случаи ОМС; числитель — два вида выписных эпикризов.','rows':rows}
details['hospital']=dn;oids['hospital']=do;monthly['hospital']=monthly_rows(p,c)

def remd_counts(root):
    ws=openpyxl.load_workbook(one(root,'1.Отчет СЭМД_РЭМД'),read_only=True,data_only=True)['Отчет РЭМД по МО']; out={}
    for r in ws.iter_rows(min_row=8,values_only=True):
        if r[2]: out[str(r[2])]={'name':str(r[1]),'s122':n(r[80]),'s228':n(r[107])}
    return out
def foms(root):
    ws=openpyxl.load_workbook(one(root,'Количество_СЭМД_Результаты'),read_only=True,data_only=True).active; out={}
    for r in ws.iter_rows(min_row=5,values_only=True):
        if r[1] and r[2]: out[str(r[2])]={'name':str(r[1]),'den':n(r[3])}
    return out
def preventive(root):
    rr,ff=remd_counts(root),foms(root); rows=[];missing=[]
    for oid,v in ff.items():
        if oid not in rr:
            missing.append({'oid':oid,'name':v['name'],'denominator':v['den']}); continue
        rv=rr[oid]; num=max(rv['s122'],rv['s228']); den=v['den']
        rows.append({'name':v['name'],'oid':oid,'semd122':rv['s122'],'semd228':rv['s228'],'selected':num,'selectedType':'122' if rv['s122']>=rv['s228'] else '228','foms':den,'share':num/den*100 if den else None,'quantity':f'{num:,} / {den:,}'.replace(',',' ')})
    return rows,missing
pj,mj=preventive(JUL); pa,ma=preventive(AUG); pm={x['oid']:x for x in pj}
# One unmatched private/out-of-region row (denominator 1) is retained in audit, not scored.
audit_rows=[];rows=[];dn={};do={}
for x in pa:
    old=pm.get(x['oid']); fact=x['share'] or 0; prev=old['share'] if old else None
    audit_rows.append({**{k:v for k,v in x.items() if k!='quantity'},'child':False,'oldShare':prev,'change':None if prev is None else fact-prev,'issues':[]})
    row={'name':x['name'],'oid':x['oid'],'fact':fact,'count':x['selected'],'previous':prev,'trend':None if prev is None else fact-prev};rows.append(row)
    d={'volume':x['foms'],'registered':x['selected']};dn[norm(x['name'])]=d;do[x['oid']]=d
num=sum(x['selected'] for x in pa); den=sum(x['foms'] for x in pa)
audit={'summary':{'status':'ready','year':2026,'formula':'MAX(СЭМД 122; СЭМД 228) по каждой МО','period122':'01.01.2026–31.08.2026','period228':'01.01.2026–31.08.2026','source122':one(AUG,'1.Отчет СЭМД_РЭМД').name,'source228':one(AUG,'1.Отчет СЭМД_РЭМД').name,'sourceDenominator':one(AUG,'Количество_СЭМД_Результаты').name,'organizations':len(pa),'numerator':num,'denominator':den,'share':num/den*100,'selected122':sum(x['selectedType']=='122' for x in pa),'selected228':sum(x['selectedType']=='228' for x in pa),'selectedEqual':sum(x['semd122']==x['semd228'] for x in pa),'changed':sum(bool(pm.get(x['oid'])) and abs((x['share'] or 0)-(pm[x['oid']]['share'] or 0))>1e-9 for x in pa),'changedChildren':0,'over100':sum((x['share'] or 0)>100 for x in pa),'zeroDenominatorWithSemd':sum(not x['foms'] and x['selected']>0 for x in pa),'missing':len(ma),'excluded':ma,'childrenMissing':False,'childOrganizations':None,'note':'Включены взрослые и детские МО из ФОМС. Единственная строка без соответствия РЭМД исключена из расчёта и показана в аудите.'},'rows':audit_rows}
save('preventive-semd-audit.json',audit)
mo['semd228']={**mo['semd228'],'date':'31.08.2026','period':'01.01–31.08.2026','note':'2026: MAX(СЭМД 122; СЭМД 228) отдельно по каждой МО / обращения ФОМС. Взрослые и детские МО включены.','rows':rows}
details['semd228']=dn;oids['semd228']=do
monthly['semd228']=monthly_rows([{**x,'fact':x['share']} for x in pj],[{**x,'fact':x['share']} for x in pa])

def certificates(root,prefix,start):
    ws=openpyxl.load_workbook(one(root,prefix),read_only=True,data_only=True).active; g=defaultdict(lambda:[0,0])
    for r in ws.iter_rows(min_row=start,values_only=True):
        if r[0] and not str(r[0]).startswith('Где в столбце'): g[str(r[0])][0]+=1;g[str(r[0])][1]+=int(str(r[3] or '').strip()=='Зарегистрирован')
    return [{'name':k,'fact':v[1]/v[0]*100 if v[0] else 0,'count':v[1],'volume':v[0],'quantity':f'{v[1]:,} / {v[0]:,}'.replace(',',' ')} for k,v in g.items()]
for metric,prefix,start in [('birth','Свидетельства_о_рождении',3),('death','I_Свид-ва',4)]:
    p,c=certificates(JUL,prefix,start),certificates(AUG,prefix,start); pm={norm(x['name']):x for x in p};rows=[];dn={}
    for x in c:
        old=pm.get(norm(x['name']));x['previous']=old['fact'] if old else None;x['trend']=None if not old else x['fact']-old['fact'];x.pop('quantity');d={'volume':x.pop('volume'),'registered':x['count']};dn[norm(x['name'])]=d;rows.append(x)
    mo[metric]={**mo[metric],'date':'31.08.2026','period':'01.01–31.08.2026','note':'Полный накопительный срез; трёхдневный срок применяется к списку внимания, а не к общему факту.','rows':rows};details[metric]=dn;monthly[metric]=monthly_rows(p,c)

def max_rows(root,col):
    ws=openpyxl.load_workbook(one(root,'ТМК_МАХ'),read_only=True,data_only=True)['Лист1'];return [{'name':str(r[0]),'fact':n(r[col]),'quantity':str(n(r[col]))} for r in ws.iter_rows(min_row=3,values_only=True) if r[0]]
for metric,col,title in [('tmkMaxCount',3,'Количество проведённых ТМК посредством МАХ'),('elnMaxCount',4,'Количество ЛВН, закрытых после ТМК посредством МАХ')]:
    p,c=max_rows(JUL,col),max_rows(AUG,col); pm={norm(x['name']):x for x in p};rows=[]
    for x in c:
        old=pm.get(norm(x['name']));rows.append({'name':x['name'],'fact':x['fact'],'count':x['fact'],'previous':old['fact'] if old else None,'trend':None if not old else x['fact']-old['fact']})
    operational[metric]={**operational[metric],'name':title,'date':'31.08.2026','period':'01.01–31.08.2026','note':'Полный накопительный срез; слоты не входят в расчёт. Региональные оперативные значения МАХ вынесены в отдельный контрольный блок.','rows':rows}
    monthly[metric]=monthly_rows(p,c,unit='count')

# Physician month-to-month metrics.
SPECIALTIES={'Акушер-гинеколог':'doctor500_obgyn','Врач общей практики':'doctor500_gp','Кардиолог':'doctor500_cardiologist','Онколог':'doctor500_oncologist','Офтальмолог':'doctor500_ophthalmologist','Педиатр':'doctor500_pediatrician','Стоматолог':'doctor500_dentist','Терапевт':'doctor500_therapist','Хирург':'doctor500_surgeon'}
def physicians(root):
    src=one(root,'Отчёт_по_врачам');wb=openpyxl.load_workbook(src,read_only=True,data_only=True); out={}
    ar=[r for r in wb['Все врачи_Детализация по МО'].iter_rows(min_row=9,values_only=True) if r[0]=='Республика Татарстан' and r[1]]
    def mk(rows,numi,deni): return [{'name':str(r[2]),'oid':str(r[1]),'fact':n(r[numi])/n(r[deni])*100 if n(r[deni]) else 0,'count':n(r[numi]),'volume':n(r[deni]),'quantity':f'{n(r[numi]):,} / {n(r[deni]):,}'.replace(',',' ')} for r in rows]
    out['doctorsAll']=mk(ar,6,4);out['doctorsLevel3']=mk([r for r in ar if r[3]=='III уровень'],6,4)
    sr=[r for r in wb['Врачи по спец-тям_По МО'].iter_rows(min_row=9,values_only=True) if r[0]=='Республика Татарстан' and r[4] in SPECIALTIES]
    for sp,key in SPECIALTIES.items(): out[key]=mk([r for r in sr if r[4]==sp],9,5)
    return out
pjh,pah=physicians(JUL),physicians(AUG); phys=load('physician-metrics.json')
for metric,c in pah.items():
    p=pjh[metric]; pm={x['oid']:x for x in p}; rows=[]
    for x in c:
        old=pm.get(x['oid']); warning='Справочно: в МО только 1–2 врача этой специальности; в заслушивании не оценивается.' if metric.startswith('doctor500_') and x['volume']<3 else None
        rows.append({k:v for k,v in x.items() if k!='quantity'}|{'previous':old['fact'] if old else None,'trend':None if not old else x['fact']-old['fact'],'sourceWarning':warning})
    ds=phys['datasets'][metric];ds['date']='31.08.2026';ds['period']='август 2026';ds['rows']=rows;ds['summary']={'numerator':sum(x['count'] for x in c),'denominator':sum(x['volume'] for x in c),'fact':sum(x['count'] for x in c)/sum(x['volume'] for x in c)*100}
    monthly[metric]={'unit':'%','previousLabel':'Июль 2026','currentLabel':'Август 2026','rows':monthly_rows(p,c)['rows']}
phys['source']=one(AUG,'Отчёт_по_врачам').name;phys['formed']='31.08.2026';phys['period']='август 2026'

save('mo-data.json',mo);save('mo-details.json',details);save('mo-detail-oids.json',oids);save('monthly-mo.json',monthly);save('operational-mo.json',operational);save('physician-metrics.json',phys)
print(json.dumps({'preventive':{'july':sum(x['selected'] for x in pj)/sum(x['foms'] for x in pj)*100,'august':num/den*100,'numerator':num,'denominator':den,'excluded':ma},'physicians':{k:{'july':sum(x['count'] for x in pjh[k])/sum(x['volume'] for x in pjh[k])*100,'august':phys['datasets'][k]['summary']['fact']} for k in pah}},ensure_ascii=False,indent=2))
