"""Apply validated intake and reconcile REMD summary; keep unmatched periods separate."""
import json
import re
import hashlib
from collections import defaultdict
from pathlib import Path
import openpyxl

ROOT=Path(__file__).resolve().parents[1]
INTAKE=ROOT.parent/'intake-20261014'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,d): p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
report=read(INTAKE/'candidate/staging-manifest.json')
assert report['formalValidation']['summary']['FAIL']==0
monthly_before=(ROOT/'app/physician-metrics.json').read_bytes()
for name in report['changedFiles']:
    incoming=read(INTAKE/'candidate/app'/name)
    if name=='physician-metrics.json':
        assert incoming==read(ROOT/'app'/name)
        continue
    if name=='mo-data.json':
        incoming['ambulatoryCase']['note']=incoming['ambulatoryCase']['note'].replace('Источник сформирован 31.08.2026.','Источник обновлен по выгрузке 13.10.2026 за период 01.01–12.10.2026.')
    write(ROOT/'app'/name,incoming)
assert (ROOT/'app/physician-metrics.json').read_bytes()==monthly_before

source=next((INTAKE/'input').glob('1.Отчет*'))
ws=openpyxl.load_workbook(source,read_only=True,data_only=True)['Отчет РЭМД']
rows=list(ws.values); heading=str(rows[0][0]); formed=str(rows[1][0]).split(': ',1)[1]
dates=re.findall(r'\d{2}\.\d{2}\.\d{4}',heading); assert dates==['01.01.2026','13.10.2026']
names,formats,values=rows[4],rows[5],rows[7]
grouped=defaultdict(lambda:{'count':0,'formats':[]});last=''
for i in range(3,len(values)):
    if names[i]:last=str(names[i]).strip()
    if not last:continue
    value=values[i]
    if value is None and names[i] is None and formats[i] is None:continue
    assert isinstance(value,(int,float)) and value>=0,(i,last,value)
    grouped[last]['count']+=int(value)
    if formats[i] and str(formats[i]) not in grouped[last]['formats']:grouped[last]['formats'].append(str(formats[i]))
summary={'period':'–'.join(dates),'formed':formed,'source':source.name,'total':int(values[2]),'registeredTypes':int(values[1]),'items':[{'name':k,'count':v['count'],'format':' / '.join(v['formats']) or '—'} for k,v in grouped.items()]}
assert sum(r['count'] for r in summary['items'])==summary['total']
assert sum(r['count']>0 for r in summary['items'])==summary['registeredTypes']
write(ROOT/'app/semd-summary.json',summary)
control=read(ROOT/'app/federal-control.json')
patterns={'37':'Экстренное извещение об инфекционном заболевании','38':'Выписка из протокола решения врачебной комиссии','39':'Льготный рецепт'}
for id,needle in patterns.items():
    matches=[r for r in summary['items'] if (needle.casefold() == r['name'].casefold() if id=='38' else r['name'].casefold().startswith(needle.casefold()))]
    assert len(matches)==1,(id,matches)
    row=next(r for r in control['agreement'] if r['id']==id)
    row.update(regionalFact=f"{matches[0]['count']:,} СЭМД".replace(',', '\u00a0'),regionalPeriod='01.01–13.10.2026',status='Достигнут',regionalManualStatus='achieved',sourceNote='Источник: накопительная выгрузка РЭМД '+source.name+', 01.01–13.10.2026. Передача СЭМД подтверждена. Статус «Достигнут» установлен по управленческому решению 14.10.2026; автоматизированный способ формирования отдельно не верифицирован.')
for id,needle in [('39.1','Льготный рецепт'),('39.2','Рецепт на лекарственный препарат')]:
    match=next(r for r in summary['items'] if r['name'].startswith(needle))
    row=next(r for r in control['agreement'] if r['id']==id)
    row.update(regionalFact=f"{match['count']:,} СЭМД".replace(',', ' '),regionalPeriod='01.01–13.10.2026',sourceNote='Источник: '+source.name+', лист «Отчет РЭМД». Подтвержденное количество зарегистрированных СЭМД за 01.01–13.10.2026.')
write(ROOT/'app/federal-control.json',control)

items=[]
def risk(severity,source,issue,impact,fix,status='Требует уточнения'):
    items.append(dict(severity=severity,source=source,issue=issue,impact=impact,fix=fix,status=status))
risk('critical','ЕПГУ, 01.01–13.10.2026','Производные столбцы источника содержат отрицательные остатки −209 и −6 440','Прямое использование этих столбцов искажает задолженность и оценку МО.','Расчет ведется по первичным компонентам: незавершенные 40 035 − 39 826 = 209; завершенные позднее срока 39 826 − 33 595 = 6 231. Отрицательные производные столбцы не используются.','Исправлена')
risk('critical','Профилактика — СЭМД 122/228 и обращения ФОМС','Входные файлы имеют разные окончания периода: 12 и 13 октября','Нельзя использовать числитель и знаменатель за разные периоды.','Сохранен предыдущий подтвержденный расчет. Нужен единый комплект за одну дату; методика MAX(122;228) по каждой МО не меняется.')
mo=read(ROOT/'app/mo-data.json')
over=[r for r in mo['hospital']['rows'] if r.get('fact') is not None and r['fact']>100]
if over:risk('high','Госпитализации, 01.01–12.10.2026',f'У {len(over)} МО зарегистрированных документов больше, чем случаев','Доля превышает 100%; возможны повторные или исправленные версии СЭМД.','Факты источника не скрываются; проверяется уникальность документов. Ограничение рейтингового балла сохраняется.')
weekly=read(ROOT/'app/physician-weekly-snapshot.json')
risk('high','Врачи и специальности 500+','Октябрьский файл не является полным календарным месяцем','Подмена полного сентября октябрьским оперативным срезом исказила бы месячный рейтинг.','Полный сентябрь сохранен без изменений; новый срез на '+weekly['date']+' хранится отдельно. При открытии врачебных показателей выбран месячный режим.','Исправлена')
risk('high','МБТ 37–39','При плане «Да» числовой факт СЭМД отображался как «Нет сопоставимого плана»','Согласованный статус не был виден в федеральной таблице.','Обе таблицы учитывают утвержденный статус «Достигнут». Наличие передачи не выдается за отдельную техническую проверку автоматизации.','Исправлена')
risk('medium','Электронный путевой лист','В новом комплекте отсутствует источник ЭПЛ','У показателя остается прежняя дата актуальности.','Предыдущие данные сохранены с исходным периодом; отсутствие выгрузки не заменяется нулем.')
risk('high','МБТ 22','В сохраненной записи указан статус «Достигнут», но факт 14,43% ниже плана 25%','Текстовый статус источника противоречит сравнению факта и плана.','Карточка оценивает показатель как невыполненный. План и методика не изменены; требуется актуальный первичный отчет.')
op=read(ROOT/'app/operational-mo.json')
decreases=[id for id in ['tmkMaxCount','elnMaxCount','shortInput','shortInputAmb','shortInputHosp'] if any(r.get('previous') is not None and r.get('fact') is not None and r['fact']<r['previous'] for r in op[id]['rows'])]
decrease_labels={'tmkMaxCount':'ТМК через МАХ','elnMaxCount':'ЛВН через МАХ','shortInput':'краткий ввод — всего','shortInputAmb':'краткий ввод — амбулаторно','shortInputHosp':'краткий ввод — стационар'}
if decreases:risk('high','Накопительные выгрузки','Есть уменьшения значений по отдельным МО: '+', '.join(decrease_labels[k] for k in decreases),'Уменьшение накопительного объема может быть корректировкой состава источника.','Показаны реальные факты и предупреждения; уменьшения не интерпретируются автоматически как улучшение работы.')
write(ROOT/'app/methodology-audit.json',{'checkedAt':'14.10.2026','note':'Проверен комплект выгрузок 14.10.2026. Ниже — актуальные риски и подтвержденные исправления; исторические замечания не считаются устраненными без проверки.','items':items})
evidence={'sourceFiles':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((INTAKE/'input').glob('*')) if p.suffix in ('.xlsx','.xls')},'statistics':report['statistics'],'retained':[{'metric':r['metric'],'errors':r['errors']}for r in report['indicators']if r['state']!='PREPARED'],'semdSummary':{k:summary[k]for k in ('total','registeredTypes','period','formed')},'monthlyPhysiciansPreserved':True,'methodologyAuditItems':len(items)}
write(ROOT/'docs/update-20261014-evidence.json',evidence)
print(json.dumps(evidence,ensure_ascii=False))
