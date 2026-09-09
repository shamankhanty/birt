#!/usr/bin/env python3
import json, re
from collections import defaultdict, Counter
from pathlib import Path
from openpyxl import load_workbook
import xlrd

SITE=Path(__file__).resolve().parents[1]
UP=Path('/workspace/scratch/8e713f374d53/upload')

def dump(name,obj):
    (SITE/'app'/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def text(v): return '' if v is None else str(v).strip()
def norm(v):
    v=text(v).lower().replace('ё','е')
    v=re.sub(r'^(?:филиал\s+)?(?:гауз|гбуз|гбу|фгбу|фгаоу\s*во|ао|ооо|чуз)(?:\s+рт)?\s*','',v)
    v=re.sub(r'["«»]','',v); v=re.sub(r'\s*\([^)]*\)\s*$','',v)
    v=v.replace('городская клиническая больница','гкб').replace('городская больница','гб').replace('городская поликлиника','гп').replace('центральная районная больница','црб')
    v=re.sub(r'\s*№\s*','№',v)
    return re.sub(r'[^а-яa-z0-9№]+',' ',v).strip()
def private(name): return bool(re.match(r'^(?:ООО|АО|ЧУЗ)\b',text(name),re.I))
def one(pattern):
    items=list(UP.glob(pattern))
    if not items: raise FileNotFoundError(pattern)
    return items[-1]
def previous_map(ds): return {norm(r['name']):r.get('fact') for r in ds.get('rows',[])}
def rows_dataset(name,plan,unit,date,raw,old,mode=None,direction=None,period=None,note=None):
    # Idempotency guard: on a repeated run for the same reporting date, keep
    # the already stored true previous values instead of comparing the slice
    # with itself.
    if old.get('date') == date:
        prev={norm(r['name']):r.get('previous') for r in old.get('rows',[])}
    else:
        prev=previous_map(old)
    rows=[]
    for r in raw:
        p=prev.get(norm(r['name']))
        r['previous']=p; r['trend']=r['fact']-p if p is not None else None
        rows.append(r)
    out={'name':name,'plan':plan,'unit':unit,'date':date,'rows':rows}
    if mode:out['mode']=mode
    if direction:out['direction']=direction
    if period:out['period']=period
    if note:out['note']=note
    return out

mo=json.loads((SITE/'app/mo-data.json').read_text(encoding='utf-8'))
op=json.loads((SITE/'app/operational-mo.json').read_text(encoding='utf-8'))
status=json.loads((SITE/'app/organization-status.json').read_text(encoding='utf-8'))
details=json.loads((SITE/'app/mo-details.json').read_text(encoding='utf-8'))
detail_oids=json.loads((SITE/'app/mo-detail-oids.json').read_text(encoding='utf-8')) if (SITE/'app/mo-detail-oids.json').exists() else {}
# Удаляем временные OID-ключи старой схемы: они дублировали компоненты при
# суммировании. OID-связи хранятся отдельно в mo-detail-oids.json.
for metric_details in details.values():
    for detail_key in [key for key in metric_details if key.startswith('oid:')]:
        del metric_details[detail_key]

def detect_data_start(ws,name_col,oid_col,den_col):
    """Find the first real MO row by content; never trust a fixed row number."""
    for row_no,row in enumerate(ws.iter_rows(values_only=True),start=1):
        nm=text(row[name_col]) if len(row)>name_col else ''
        oid=text(row[oid_col]) if len(row)>oid_col else ''
        den=row[den_col] if len(row)>den_col else None
        if nm and not nm.lower().startswith('итого') and re.fullmatch(r'\d+(?:\.\d+)+',oid) and isinstance(den,(int,float)):
            return row_no
    raise ValueError(f'Не найдена первая строка данных в листе {ws.title}')

def set_ratio(metric,path,sheet,start,name_col,oid_col,den_col,num_cols,name,plan,date,period,note=None):
    ws=load_workbook(path,read_only=True,data_only=True)[sheet]
    detected_start=detect_data_start(ws,name_col,oid_col,den_col)
    if start is not None and start != detected_start:
        print(f'Предупреждение: {metric}: задана строка {start}, по содержимому найдена {detected_start}; используется найденная строка.')
    start=detected_start
    raw=[]; det={}; oid_det={}
    for row in ws.iter_rows(min_row=start,values_only=True):
        nm=text(row[name_col]); den=row[den_col]
        if not nm or nm.lower().startswith('итого') or not isinstance(den,(int,float)):continue
        num=sum((row[i] or 0) for i in num_cols if isinstance(row[i],(int,float)))
        fact=num/den*100 if den else 0
        oid=text(row[oid_col])
        raw.append({'name':nm,'oid':oid,'fact':fact,'count':int(num)})
        detail={'volume':int(den),'registered':int(num)}
        det[norm(nm)]=detail
        if oid: oid_det[oid]=detail
    if not raw:
        raise ValueError(f'{metric}: после разбора исходника нет строк МО')
    missing_oids=[r['name'] for r in raw if not r['oid']]
    if missing_oids:
        print(f'Предупреждение: {metric}: у {len(missing_oids)} строк отсутствует OID: {missing_oids[:3]}')
    source_num=sum(int(r['count']) for r in raw)
    source_den=sum(int(row[den_col]) for row in ws.iter_rows(min_row=start,values_only=True)
                   if text(row[name_col]) and not text(row[name_col]).lower().startswith('итого') and isinstance(row[den_col],(int,float)))
    if source_num != sum(int(r['count']) for r in raw):
        raise ValueError(f'{metric}: не сошлась контрольная сумма числителя')
    mo[metric]=rows_dataset(name,plan,'%',date,raw,mo.get(metric,{}),period=period,note=note)
    details[metric]=det
    detail_oids[metric]=oid_det
    return source_num,source_den

# СЭМД №228
semd=set_ratio('semd228',one('*профилактическ*17.08*.xlsx'),'Лист1',4,0,1,2,[3],
 'Доля СЭМД «Результаты профилактического медицинского осмотра/диспансеризации» (СЭМД №228) относительно количества обращений',95,'17.08.2026','01.01–17.08.2026')

# Госпитализации: новый знаменатель после исключения новорождённых без полиса ОМС.
hosp=set_ratio('hospital',one('*госпитализациям_01.01.-17.08*.xlsx'),'Лист 1',8,0,1,2,[3,4],
 'Доля СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома» относительно количества случаев',95,'17.08.2026','01.01–17.08.2026',
 'Состав знаменателя изменён: из исходника исключены новорождённые без полиса ОМС. Снижение числа случаев не трактуется как ухудшение МО.')
# Для динамики используем полный предыдущий срез, включая первые строки листа.
prev_hosp_ws=load_workbook(one('*госпитализациям_*12.08*.xlsx'),read_only=True,data_only=True)['Лист3']
prev_hosp={}
for row in prev_hosp_ws.iter_rows(min_row=detect_data_start(prev_hosp_ws,1,2,3),values_only=True):
    if text(row[1]) and isinstance(row[3],(int,float)):
        num=sum((row[i] or 0) for i in (4,5) if isinstance(row[i],(int,float)))
        prev_hosp[text(row[2])]=num/row[3]*100 if row[3] else 0
for row in mo['hospital']['rows']:
    previous=prev_hosp.get(row.get('oid',''))
    row['previous']=previous
    row['trend']=row['fact']-previous if previous is not None else None

# Амбулаторный эпикриз, фактический период внутри файла до 11.08.
amb=set_ratio('ambulatoryCase',one('*законченному_случаю_амбулаторный*17.08*.xlsx'),'Лист1',4,0,1,2,[3],
 'Доля СЭМД «Эпикриз по законченному случаю амбулаторный» (СЭМД №92, №233) относительно количества случаев',95,'17.08.2026','01.01–17.08.2026')

# ЕПГУ: исключаем частную МО, как в согласованном предыдущем расчёте.
eg=load_workbook(one('*ПР_2*17.08*.xlsx'),read_only=True,data_only=True).active
eg_raw=[]; eg2_raw=[]; eg_det={};eg2_det={};eg_oid_det={};eg2_oid_det={}
for row in eg.iter_rows(min_row=4,values_only=True):
    nm=text(row[2]); submitted=row[4]
    if not nm or private(nm) or not isinstance(submitted,(int,float)):continue
    final=row[5] or 0; two=row[6] or 0
    oid=text(row[3])
    eg_raw.append({'name':nm,'oid':oid,'fact':final/submitted*100 if submitted else 0,'count':int(final)})
    eg2_raw.append({'name':nm,'oid':oid,'fact':two/submitted*100 if submitted else 0,'count':int(two)})
    final_detail={'volume':int(submitted),'registered':int(final)}
    two_detail={'volume':int(submitted),'registered':int(two)}
    eg_det[norm(nm)]=final_detail; eg2_det[norm(nm)]=two_detail
    if oid:
        eg_oid_det[oid]=final_detail; eg2_oid_det[oid]=two_detail
mo['egpu']=rows_dataset('Доля заявлений о прикреплении на ЕПГУ',100,'%','17.08.2026',eg_raw,mo.get('egpu',{}),period='01.01–17.08.2026',note='Частные МО исключены из республиканского итога и управленческих списков.')
mo['egpu2days']=rows_dataset('Доля заявлений о прикреплении на ЕПГУ, рассмотренных за 2 рабочих дня',90,'%','17.08.2026',eg2_raw,mo.get('egpu2days',{}),period='01.01–17.08.2026',note='Контрольный срок — 2 рабочих дня. Частные МО исключены.')
details['egpu']=eg_det;details['egpu2days']=eg2_det
detail_oids['egpu']=eg_oid_det;detail_oids['egpu2days']=eg2_oid_det

# Свидетельства: частные МО исключены из итога и списка внимания.
def registry_metric(metric,path,start,name,title,date):
    ws=load_workbook(path,read_only=True,data_only=True).active
    agg=defaultdict(lambda:[0,0])
    for row in ws.iter_rows(min_row=start,values_only=True):
        nm=text(row[0]); st=text(row[3]).lower()
        if not nm or nm.startswith('Где в столбце'):continue
        agg[nm][0]+=1; agg[nm][1]+=int(st=='зарегистрирован')
    raw=[];det={}
    for nm,(den,num) in agg.items():
        raw.append({'name':nm,'fact':num/den*100 if den else 0,'count':num})
        det[norm(nm)]={'volume':den,'registered':num}
    mo[metric]=rows_dataset(title,99,'%',date,raw,mo.get(metric,{}),period=f'01.01–{date}')
    details[metric]=det
    return sum(v[1] for v in agg.values()),sum(v[0] for v in agg.values())
birth=registry_metric('birth',one('*рождении*17.08*.xlsx'),3,'name','МСР','17.08.2026')
death=registry_metric('death',one('*смерти*17.08*.xlsx'),4,'name','МСС','17.08.2026')

# Краткий ввод: общий, амбулаторный и стационарный блоки. Меньше — лучше.
sw=load_workbook(one('*краткого ввода*17.08*.xlsx'),read_only=True,data_only=True).active
short_all=[];short_amb=[];short_hosp=[]
for row in sw.iter_rows(min_row=7,values_only=True):
    nm=text(row[0]);
    if not nm:continue
    a=(row[3] or 0)+(row[6] or 0); h=(row[4] or 0)+(row[5] or 0); total=a+h
    base={'name':nm,'oid':text(row[1])}
    short_all.append({**base,'fact':total,'count':total});short_amb.append({**base,'fact':a,'count':a});short_hosp.append({**base,'fact':h,'count':h})
op['shortInput']=rows_dataset('Количество случаев краткого ввода — всего',0,'','17.08.2026',short_all,op.get('shortInput',{}),mode='count',direction='lower',period='01.01–17.08.2026',note='Накопление является ухудшением. В недельной динамике оценивается прирост новых случаев.')
op['shortInputAmb']=rows_dataset('Краткий ввод — амбулаторный блок и профилактика',0,'','17.08.2026',short_amb,op.get('shortInputAmb',{}),mode='count',direction='lower',period='01.01–17.08.2026')
op['shortInputHosp']=rows_dataset('Краткий ввод — круглосуточный и дневной стационар',0,'','17.08.2026',short_hosp,op.get('shortInputHosp',{}),mode='count',direction='lower',period='01.01–17.08.2026')

# МАХ
mx=load_workbook(one('*ТМК_МАХ*18.08*.xlsx'),read_only=True,data_only=True)['Лист1']
tmk=[];eln=[]
for row in mx.iter_rows(min_row=3,values_only=True):
    nm=text(row[0]);
    if not nm or nm.lower().startswith('итого'):continue
    t=int(row[3] or 0);e=int(row[4] or 0)
    tmk.append({'name':nm,'fact':t,'count':t});eln.append({'name':nm,'fact':e,'count':e})
op['tmkMaxCount']=rows_dataset('Количество проведённых ТМК посредством МАХ',10000,'','18.08.2026',tmk,op.get('tmkMaxCount',{}),mode='count',period='01.08–18.08.2026')
op['elnMaxCount']=rows_dataset('Количество ЛВН, закрытых после ТМК посредством МАХ',10000,'','18.08.2026',eln,op.get('elnMaxCount',{}),mode='count',period='01.08–18.08.2026')

# ФАП/ФП — новая базовая точка, динамику не рассчитываем из-за изменения охвата.
fw=load_workbook(one('*ФАП*11.08*.xlsx'),read_only=True,data_only=True)['Лист1']
fagg=defaultdict(lambda:[0,0,0])
for row in fw.iter_rows(min_row=5,values_only=True):
    nm=text(row[0]);c=row[3]
    if not nm or not isinstance(c,(int,float)):continue
    fagg[nm][0]+=int(c);fagg[nm][1]+=1;fagg[nm][2]+=int(c==0)
frows=[{'name':nm,'fact':v[0],'count':v[0],'previous':None,'trend':None,'sourceWarning':f'{v[2]} ФАП/ФП с нулевым результатом из {v[1]}'} for nm,v in fagg.items()]
op['fapSemdCount']={'name':'Количество СЭМД, зарегистрированных ФАП и ФП','plan':None,'unit':'','date':'11.08.2026','mode':'count','period':'01.01–11.08.2026','note':'Новая базовая точка: охват исходника изменён, динамика с предыдущим файлом не рассчитывается.','rows':frows}

# Карты вызова СМП из АСУ ССМП: принято / количество карт.
book=xlrd.open_workbook(str(one('*АСУ ССМП 18.08.26*.xls'))); sh=book.sheet_by_index(0)
parents={}
for i in range(8,sh.nrows):
    row=sh.row_values(i);nm=text(row[0]);cards=row[1] if len(row)>10 else 0;accepted=row[10] if len(row)>10 else 0
    if not nm or nm.lower().startswith('всего') or not isinstance(cards,(int,float)) or cards<=0:continue
    low=nm.lower()
    # В исходнике одновременно присутствуют итоговые строки станций и их
    # подстанции. Для МО берём только родительские строки, иначе объём и число
    # организаций удваиваются. Повторные родительские строки дедуплицируем.
    is_parent=low.startswith(('гауз','гбуз','гбу','фгбу','фгаоу','ао ','ооо ','чуз')) or 'лаишевск' in low or low.strip()=='тцмк'
    if not is_parent:continue
    key=norm(nm)
    prev=parents.get(key)
    candidate={'name':nm,'fact':accepted/cards*100,'count':int(accepted),'volume':int(cards),'registered':int(accepted)}
    if prev is None or candidate['volume']>prev['volume']:parents[key]=candidate
srows=list(parents.values())
mo['smp']=rows_dataset('Доля принятых в РЭМД карт вызова СМП',95,'%','17.08.2026',srows,mo.get('smp',{}),period='01.01–17.08.2026')
details['smp']={r['name']:{'volume':r['volume'],'registered':r['registered']} for r in srows}

dump('mo-data.json',mo);dump('operational-mo.json',op);dump('mo-details.json',details)
dump('mo-detail-oids.json',detail_oids)
# Статусы ЭЛМК и ТМК обновляются отдельным скриптом из профильных отчётов:
# общий отчёт РЭМД не заменяет их утверждённые плановые перечни.
print(json.dumps({'semd228':semd,'hospital':hosp,'ambulatory':amb,'birth':birth,'death':death,'short_total':sum(r['fact'] for r in short_all),'short_amb':sum(r['fact'] for r in short_amb),'short_hosp':sum(r['fact'] for r in short_hosp),'tmk':sum(r['fact'] for r in tmk),'eln':sum(r['fact'] for r in eln),'fap':sum(v[0] for v in fagg.values())},ensure_ascii=False))
