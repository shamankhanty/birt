"""Stage all-specialty FRMR/FRMO extracts. Never export full employee identifiers."""
import json,re,hashlib,collections,datetime,sys
from pathlib import Path
import openpyxl
ROOT=Path(__file__).resolve().parents[2];src=Path(sys.argv[1]);prefix='1.2.643.5.1.13.13.12.2.16.'
clean=lambda v:str(v or '').strip()
def write(name,data): (ROOT/'app'/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
def source(p):return {'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
if src.is_file():f=src;p=None
else:
 candidates=list(src.glob('АНАЛИЗ*.xlsx'));assert len(candidates)==1,'Specify the exact FRMR file when several cuts are present'
 f=candidates[0];linked=list(src.glob('Привязка*.xlsx'));assert len(linked)<=1,'Ambiguous FRMO source';p=linked[0] if linked else None
match=re.search(r'(\d{2}\.\d{2}\.\d{4})',f.name);assert match,'Source cut must be explicit in file name'
cut=datetime.datetime.strptime(match[1],'%d.%m.%Y').date();cutLabel=cut.strftime('%d.%m.%Y');wb=openpyxl.load_workbook(f,read_only=True,data_only=True)
ws=wb['Данные из ФРМР'];headers=next(ws.iter_rows(min_row=2,max_row=2,values_only=True));assert headers[12]=='OID организации' and headers[23]=='Должность по фед справочнику' and headers[17]=='Тип структурного подразделения'
issueCountColumn=headers.index('Количество расхождений');hasIssueColumn=headers.index('Наличие расхождений')
summary={};uncontrolled=[]
summarySheet=wb['OID МО. СВОД расхождений'];summaryHeaders=next(summarySheet.iter_rows(min_row=1,max_row=1,values_only=True))
currentColumns=[i for i,v in enumerate(summaryHeaders) if clean(v).startswith('Должностей') and 'Начало' not in clean(v) and re.search(r'\d{2}\.\d{2}\.\d{4}',clean(v)) and re.search(r'\d{2}\.\d{2}\.\d{4}',clean(v))[0]==cutLabel]
if not currentColumns and len(summaryHeaders)>24:
 headerDate=summaryHeaders[24]
 if isinstance(headerDate,(int,float)):headerDate=openpyxl.utils.datetime.from_excel(headerDate).date()
 if isinstance(headerDate,datetime.datetime):headerDate=headerDate.date()
 if headerDate==cut:currentColumns=[18] # Column S; date of its cut is in Y1
assert currentColumns,'No summary count for requested cut';currentColumn=currentColumns[0]
for r in wb['OID МО. СВОД расхождений'].iter_rows(min_row=2,values_only=True):
 if r[2] and r[13]:
  # Reorganized or otherwise unmonitored organizations may be explicitly
  # marked in the source instead of carrying a numeric control value.
  # They must not be converted to zero or included in the comparison.
  if not isinstance(r[currentColumn],(int,float)):
   assert clean(r[currentColumn])=='Не контролируется', (r[1],r[2],r[currentColumn])
   uncontrolled.append({'id':clean(r[13]).removeprefix(prefix),'name':clean(r[2]),'reason':'Не контролируется'})
   continue
  oid=clean(r[13]);assert oid.startswith(prefix) and oid not in summary
  assert all(r[i]==r[currentColumn] for i in currentColumns),'Conflicting duplicate cut columns';summary[oid]={'name':clean(r[2]),'count':int(r[currentColumn]),'state':r[3]==1}
mos=sorted(summary);mi={oid:i for i,oid in enumerate(mos)};roles=[];sp=[];ri={};si={};records=[];employment=[];group=collections.defaultdict(lambda:[0,0]);by=collections.defaultdict(collections.Counter);specialties=collections.Counter();quality=collections.Counter();boundary=[];sourceIssueSum=0;nonProblemRows=0;spTypes=collections.defaultdict(set)
for rownum,r in enumerate(ws.iter_rows(min_row=3,values_only=True),3):
 if not r[32] or not r[23]:continue
 if r[hasIssueColumn]==0:
  assert r[issueCountColumn] in (None,0),'Nonproblem row has issue flags';nonProblemRows+=1;continue
 spoid=clean(r[16]);sourceOid=clean(r[32]);oid=spoid.split('.0.')[0] if sourceOid=='НЕТ СВЯЗКИ С ФРМО' else sourceOid;role=clean(r[23]);name=clean(r[19]) or 'Наименование СП не указано'
 spTypes[spoid].add(clean(r[17]))
 assert oid in mi and r[38]==1
 assert not spoid or spoid.startswith(oid+'.0.'),f'Unsupported SP OID at row {rownum}'
 if role not in ri:ri[role]=len(roles);roles.append(role)
 key=(oid,spoid)
 if key not in si:si[key]=len(sp);sp.append([mi[oid],spoid.removeprefix(oid+'.0.') if spoid else '',name])
 m,a,b=mi[oid],ri[role],si[key];stage1=clean(r[34]).startswith('1 этап.');stage2=clean(r[33]).startswith('2 этап.');assert stage1 or stage2
 issue=0 if stage1 else 1;digits=re.sub(r'\D','',clean(r[0]).split('_')[0]);last4=digits[-4:] if len(digits)==11 else None;flags=0
 if last4 is None:flags|=1;quality['missingIdentifier']+=1
 if sourceOid=='НЕТ СВЯЗКИ С ФРМО':flags|=8;quality['missingOrganizationLink']+=1
 records.append([m,a,b,last4,issue,rownum,flags]);employment.append(tuple(clean(r[k]) for k in [0,16,23,25,26]));group[(m,a,b)][issue]+=1
 by[oid]['current']+=1;by[oid]['stage1' if issue==0 else 'stage2']+=1;by[oid]['role:'+role]+=1;specialties[role]+=1
 assert isinstance(r[issueCountColumn],(int,float)) and r[issueCountColumn]>=1
 sourceIssueSum+=r[issueCountColumn]
 boundary.append(rownum)
counts=collections.Counter(employment)
for rec,key in zip(records,employment):
 if counts[key]>1:rec[6]|=4;quality['repeatedRecordRows']+=1
quality['repeatedRecordExtras']=sum(n-1 for n in counts.values() if n>1)
quality['employmentEnded']=None # AB is not a reliable end date in this workbook
assert len(records)==sum(r['count'] for r in summary.values())
for oid,v in summary.items():assert v['count']==by[oid]['current'],oid
rows=[]
for oid in mos:
 v=summary[oid];b=by[oid];specs=sorted([[k[5:],n] for k,n in b.items() if k.startswith('role:')],key=lambda r:(-r[1],r[0]))
 rows.append([oid.removeprefix(prefix),v['name'],None,None,v['count'],b['stage1'],b['stage2'],None,specs])
summaryOut={'schemaVersion':2,'source':f.name,'sourceCut':cutLabel,'baselineCut':None,'scope':'all_specialties','unit':'должностная запись, не уникальный сотрудник','trend':[[cutLabel,len(records)]],'topSpecialties':sorted(specialties.items(),key=lambda r:(-r[1],r[0])),'rows':rows}
mosuffix=[o.removeprefix(prefix) for o in mos]
out={'summary':summaryOut,'departments':{'cut':cutLabel,'unit':'должностная запись','mos':mosuffix,'roles':roles,'sp':sp,'rows':[[*key,*value] for key,value in sorted(group.items())]},'records':{'cut':cutLabel,'issues':['Должность не найдена на уровне МО в ГИС','Должность есть в МО, но не найдена в указанном СП'],'qualityBits':{'1':'Отсутствует корректный идентификатор в исходнике','4':'Совпадают проверенные реквизиты кадровых записей; требуется проверка повтора','8':'В служебном поле источника нет связи МО с ФРМО'},'rows':records},'metadata':{'source':source(f),'sourceRowRange':[boundary[0],boundary[-1]],'parsedRows':len(records),'nonProblemRows':nonProblemRows,'summaryCountColumn':currentColumn+1,'sourceIssueCount':sourceIssueSum,'quality':quality,'uncontrolledOrganizations':uncontrolled,'scopeNote':f'Все должности из представленного списка расхождений. Полнота общего кадрового состава для знаменателя отдельно не подтверждена; доля ошибок не рассчитывается. В {quality["missingOrganizationLink"]} записях отсутствует служебная связь с ФРМО; OID МО установлен по OID СП и помечен для проверки.','stateOrganizations':sum(v['state'] for v in summary.values()),'stateProblemRecords':sum(v['count'] for v in summary.values() if v['state'])}}
write('frmr-all-specialties.json',out)
write('frmr-sp-types.json',{'source':source(f),'types':{k:next(iter(v)) for k,v in spTypes.items() if k and len(v)==1 and next(iter(v))},'ambiguousOids':[k for k,v in spTypes.items() if len(v)>1]})
if p is None:
 print(json.dumps({'cut':cutLabel,'positions':len(records),'organizations':len(mos),'roles':len(roles),'groups':len(group),'quality':quality,'sourceIssueCount':sourceIssueSum},ensure_ascii=False));sys.exit(0)
# Source FRMO summary counts department rows, not validated deviations.
wb=openpyxl.load_workbook(p,read_only=True,data_only=True);s=wb['Отделения и СП (филиалы)'];h=next(s.iter_rows(min_row=2,max_row=2,values_only=True));assert h[0]=='Код МО' and 'ОИД' in h[4]
summarySheet=wb['СВОД на актуальную дату'];summaryHead=next(summarySheet.iter_rows(min_row=1,max_row=1,values_only=True))
def sheet_date(value):
 if isinstance(value,datetime.datetime):return value.date()
 if isinstance(value,datetime.date):return value
 return None
summaryCut=sheet_date(summaryHead[2]);previousCut=sheet_date(summaryHead[3]);historicMatch=re.search(r'(\d{2}\.\d{2}\.\d{4})',clean(summaryHead[6]))
historicCut=datetime.datetime.strptime(historicMatch[1],'%d.%m.%Y').date() if historicMatch else None
assert summaryCut==cut and previousCut and previousCut<summaryCut
sourceSummary={clean(r[0]):[clean(r[1]),r[2],r[3],r[6],r[7]] for r in summarySheet.iter_rows(min_row=4,values_only=True) if r[0] and r[1]}
org={};detail=[];dates=[];flagcounts=collections.Counter();deptrows=collections.Counter();parents=collections.defaultdict(set)
for rownum,r in enumerate(s.iter_rows(min_row=4,values_only=True),4):
 if not r[0] or not r[1] or not r[6]:continue
 code=clean(r[0]);org[code]=clean(r[1]);b,d=clean(r[4]),clean(r[8]);flags=0
 for value in [b,d]:
  assert not value or re.fullmatch(r'\d+(\.\d+)+',value)
  if value:parents[code].add(value.split('.0.')[0])
 if not b:flags|=1
 if not d:flags|=2
 if b and d and b!=d:flags|=4
 if clean(r[3])!=clean(r[7]):flags|=8
 if clean(r[5])=='Нет' and clean(r[9])=='1':flags|=16
 date=r[10].date().isoformat() if isinstance(r[10],datetime.datetime) else clean(r[10]) or None
 detail.append([code,clean(r[2]),clean(r[6]),b or None,d or None,flags,rownum,date]);deptrows[code]+=1
 for bit in [1,2,4,8,16]:flagcounts[str(bit)]+=int(bool(flags&bit))
for code,(name,current,previous,historic,delta) in sourceSummary.items():assert current==deptrows[code],(code,current,deptrows[code])
missing=sorted(set(org)-set(sourceSummary))
detailCodes=set(org);summaryCodes=set(sourceSummary);summaryOnly=summaryCodes-detailCodes;detailOnly=detailCodes-summaryCodes
assert all(sourceSummary[code][1]==0 for code in summaryOnly)
# Detail may contain newly added/retired units that are absent from the MO
# summary. Preserve them as exceptions and do not force a zero into the summary.
flags={'1':'Нет OID СП у филиала','2':'Нет OID СП у отделения','4':'Разные OID СП у филиала и отделения','8':'Разные привязанные наименования ФРМО','16':'Активное отделение в неактивном СП по выгрузке'}
allCodes=sorted(summaryCodes|detailCodes);names={c:org.get(c,sourceSummary.get(c,[None])[0]) for c in allCodes}
summaryCurrent=sum(v[1] for v in sourceSummary.values());summaryPrevious=sum(v[2] for v in sourceSummary.values());summaryHistoric=sum(v[3] for v in sourceSummary.values())
orgIssues={c:sum(bool(r[5]) for r in detail if r[0]==c) for c in allCodes}
result={'cut':cutLabel,'previousCut':previousCut.strftime('%d.%m.%Y'),'historicCut':historicCut.strftime('%d.%m.%Y') if historicCut else None,'source':source(p),'flags':flags,'rows':detail,'organizations':[{'code':c,'name':names[c],'rows':deptrows[c],'issues':orgIssues[c],'sourceSummary':sourceSummary.get(c,[None,None,None,None,None])[1],'summaryPrevious':sourceSummary.get(c,[None,None,None,None,None])[2],'summaryHistoric':sourceSummary.get(c,[None,None,None,None,None])[3],'summaryMissing':c not in summaryCodes,'detailMissing':c not in detailCodes,'parentOids':sorted(parents[c])} for c in allCodes],'totals':{'rows':len(detail),'issues':sum(bool(r[5]) for r in detail),'consistent':sum(not r[5] for r in detail),'sourceSummaryRows':summaryCurrent,'sourceSummaryPreviousRows':summaryPrevious,'sourceSummaryHistoricRows':summaryHistoric,'summaryOrganizations':len(summaryCodes),'detailOrganizations':len(detailCodes),'organizations':len(allCodes),'missingSummaryCodes':len(detailOnly),'missingSummaryRows':sum(deptrows[c] for c in detailOnly),'summaryOnlyCodes':len(summaryOnly),'summaryOnlyRows':sum(sourceSummary[c][1] for c in summaryOnly),'flagCounts':flagcounts},'method':'Одна строка — отделение ГИС. Строка с хотя бы одним флагом учитывается один раз. Различие наименований требует проверки справочников и не доказывает ошибку OID. Категории пересекаются. Сводка и детализация показаны раздельно: они могут не содержать одинаковый набор кодов МО. Отсутствие МО в одном листе не считается нулём и не исправляется автоматически.','comparison':f"Свод исходника: {summaryPrevious} на {previousCut:%d.%m.%Y} → {summaryCurrent} на {summaryCut:%d.%m.%Y} ({summaryCurrent-summaryPrevious:+d}). Это изменение сводки; динамика числа отклонений по отделениям не рассчитывается, так как сопоставимой предыдущей детализации нет."}
write('frmo-linkage-data-20261126.json',result)
write('frmo-linkage-data.json',result)
auditOrganizations=[]
for code in allCodes:
 name=names[code];current,previous=sourceSummary.get(code,[None,None,None,None,None])[1:3]
 old=sourceSummary.get(code,[None,None,None,None,None])[3]
 auditOrganizations.append({'id':code,'name':name,'current':current if isinstance(current,(int,float)) else None,'previous':previous if isinstance(previous,(int,float)) else None,'old':old if isinstance(old,(int,float)) and historicCut else None,'hasDetail':code in detailCodes})
auditRecords=[]
for rownum,r in enumerate(s.iter_rows(min_row=4,values_only=True),4):
 if not r[0] or not r[1] or not r[6]:continue
 code=clean(r[0]);flags=0;b=clean(r[4]);d=clean(r[8])
 if not b:flags|=1
 if not d:flags|=2
 if b and d and b!=d:flags|=4
 if clean(r[3])!=clean(r[7]):flags|=8
 if clean(r[5])=='Нет' and clean(r[9])=='1':flags|=16
 date=r[10].date().isoformat() if isinstance(r[10],datetime.datetime) else clean(r[10]) or None
 reasons=[]
 if flags&4:reasons.append('oid')
 if flags&3:reasons.append('missing')
 if flags&16:reasons.append('inactive')
 if date:reasons.append('excluded')
 if flags&8:reasons.append('name')
 auditRecords.append({'mo':code,'name':clean(r[1]),'branchGis':clean(r[2]),'branchFrmo':clean(r[3]),'oidFrmo':b or None,'branchActive':clean(r[5]),'department':clean(r[6]),'departmentBranch':clean(r[7]),'departmentOid':d or None,'departmentActive':clean(r[9]),'excludedAt':date,'flags':reasons})
audit={'sourceCut':cutLabel,'previousCut':previousCut.strftime('%d.%m.%Y'),'historicCut':historicCut.strftime('%d.%m.%Y') if historicCut else None,'summary':auditOrganizations,'records':auditRecords,'summarySourceCount':len(summaryCodes),'detailOrganizationCount':len(detailCodes),'summaryOnlyCount':len(summaryOnly),'detailOnlyCount':len(detailOnly),'source':source(p)}
write('frmr-sp-audit-20261126.json',audit)
print(json.dumps({'frmr':{'positions':len(records),'organizations':len(mos),'roles':len(roles),'groups':len(group),'quality':quality},'frmo':result['totals']},ensure_ascii=False))
