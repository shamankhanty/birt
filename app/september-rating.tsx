"use client";
import {useMemo,useState} from 'react';
import inputs from './rating/september-v2-inputs.json';
import legacy from './rating/september-v1.json';
import policy from '../config/september-rating-v2.json';
import {buildSeptemberRating,metricScore} from '../lib/september-rating.js';
const fmt=(v:number|null|undefined,d=2)=>v==null?'—':(Math.abs(v)<0.005?0:v).toLocaleString('ru-RU',{maximumFractionDigits:d,minimumFractionDigits:0});
const blockNames:Record<string,string>={care:'Медицинская помощь',services:'Цифровые услуги',readiness:'Готовность'};
export default function SeptemberRating(){
 const rows=useMemo(()=>buildSeptemberRating(inputs,legacy,policy),[]);
 const types=[...new Set(rows.map(r=>r.type))];
 const [type,setType]=useState('Центральные районные больницы');
 const [query,setQuery]=useState('');
 const [onlyMissing,setOnlyMissing]=useState(false);
 const group=rows.filter(r=>r.type===type);
 const visible=group.filter(r=>(!onlyMissing||!r.complete)&&`${r.name} ${r.key}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).sort((a,b)=>(a.place??999)-(b.place??999)||a.name.localeCompare(b.name,'ru'));
 return <section className="septemberRating" aria-label="Сентябрьский рейтинг по новой методике">
  <div className="pageHead ratingHead"><div><p className="eyebrow">ПЕРЕСЧЁТ МЕТОДИКИ · ВЕРСИЯ 2</p><h1>Месячный рейтинг МО — сентябрь 2026</h1><p>Места внутри типа МО · прежняя версия сохранена · изменение балла не является динамикой работы</p></div><div className="ratingFormula"><small>Закрытый период</small><strong>Сентябрь 2026</strong><span>Октябрьские данные исключены</span></div></div>
  <details className="septMethod"><summary>Методика, периоды и ограничения</summary><div className="septMethodBody">
   <p><b>70% — медицинская помощь, 20% — цифровые услуги, 10% — готовность.</b> Каждый показатель: факт / план × 100, максимум 100 баллов. Перевыполнение не даёт дополнительных баллов.</p>
   <p>В готовности: ТВСП — 50%, активность врачей — 25%, группа специальностей 500+ — 25%. Внутри групп показатели равновесны. Неприменимые по подтверждённому профилю показатели и нулевые знаменатели исключаются; их веса перераспределяются в пределах группы, затем блока.</p>
   <p><b>Официальное место — только при полном обязательном наборе.</b> При пропусках показан диапазон возможного балла и перечень недостающих данных. Пропуск не считается фактом 0 и не улучшает место. «Лидер» — от 95 баллов, если каждый ключевой показатель помощи выполнен хотя бы на 80% своего плана.</p>
   <p><b>Периоды:</b> врачи и ЕПГУ — 01.09–30.09; СЭМД и ТВСП — накопительно 01.01–30.09. Это оценка состояния на сентябрьском срезе, а не месячный поток СЭМД. РЭМД сформирован 30.09 в 14:44; более поздний сентябрьский результат не подразумевается.</p>
   <p>СЭМД профилактики = MAX(122; 228) / случаи ФОМС. Стационарные эпикризы = (выписной эпикриз + эпикриз роддома) / случаи ОМС из одного отчёта. ЕПГУ: финальный статус / заявления и обработка за 2 рабочих дня / заявления.</p>
   <p>{inputs.profileRule}</p>
   <ul>{inputs.exclusions.map(e=><li key={e.id}>{e.reason}</li>)}</ul>
   <p>Равные баллы дают одинаковое место. Изменение состава допущенных МО также меняет место, поэтому стрелки роста и падения здесь не используются. Объединения доступны в прежней версии; их методика этим пересчётом не изменена.</p>
   <details><summary>Исходники и контрольные суммы</summary>{Object.values(inputs.sources).map(s=><p key={s.sha256} className="septSource">{s.file}<br/><code>{s.sha256}</code></p>)}<p>Кадры и ТВСП — зафиксированные сентябрьские наборы; контрольные суммы сохранены в версии расчёта.</p></details>
  </div></details>
  <div className="ratingTypeTabs septTypeTabs" role="group" aria-label="Тип медицинской организации">{types.map(t=><button key={t} className={type===t?'active':''} onClick={()=>setType(t)}>{t}<small>{rows.filter(r=>r.type===t).length}</small></button>)}</div>
  <div className="septStats"><article><small>МО в группе</small><strong>{group.length}</strong></article><article><small>Получили место</small><strong>{group.filter(r=>r.complete).length}</strong></article><article><small>Предварительно</small><strong>{group.filter(r=>!r.complete).length}</strong></article><article><small>Лидеры</small><strong>{group.filter(r=>r.status==='Лидер').length}</strong></article></div>
  <div className="septTools"><input aria-label="Найти МО в сентябрьском рейтинге" placeholder="Найти МО или OID" value={query} onChange={e=>setQuery(e.target.value)}/><label><input type="checkbox" checked={onlyMissing} onChange={e=>setOnlyMissing(e.target.checked)}/> Только с неполными данными</label></div>
  <div className="septTableWrap"><table className="septTable"><thead><tr><th>МО</th><th>Место<br/>было → стало</th><th>Балл<br/>было → стало</th><th>Помощь<br/>70%</th><th>Услуги<br/>20%</th><th>Готовность<br/>10%</th><th>Полнота</th><th>Статус</th></tr></thead><tbody>{visible.map(r=><tr key={r.key}><td><details className="septOrg"><summary><b>{r.name}</b><small>{r.key.startsWith("context:")?"OID требует подтверждения":r.key}</small><span>Расчёт и причины изменения</span></summary><div className="septOrgDetails"><p><b>Пересчёт того же сентября:</b> {r.reasons.join(' ')}</p>{r.missing.length>0&&<p className="septMissing"><b>Не хватает:</b> {r.missing.map(m=>m.name).join('; ')}.</p>}<div className="septMetricList">{r.metrics.map(m=><article key={m.id}><b>{m.name}</b><small>{m.period} · {m.periodKind==='monthly'?'за месяц':'накопительно'}</small><span>{m.status==='available'?`${fmt(m.numerator,0)} / ${fmt(m.denominator,0)} · ${fmt(m.fact)}% · план ${fmt(m.plan)}% · ${fmt(metricScore(m))} балла`:m.status==='not_applicable'?'Не применяется: нулевой знаменатель':'Нет подтверждённых данных'}</span>{m.mappingNote&&<small>{m.mappingNote}</small>}{m.s122!==undefined&&<small>122: {fmt(m.s122,0)} · 228: {fmt(m.s228,0)} · взят максимум</small>}</article>)}</div></div></details></td><td>{r.oldPlace??'—'} → <b>{r.place??'—'}</b></td><td>{fmt(r.oldScore)} → <b>{r.complete?fmt(r.score):r.low===null?'—':`${fmt(r.low)}–${fmt(r.high)}`}</b>{r.scoreChange!==null&&<small className="septRecalc">{r.scoreChange>0?'+':''}{fmt(r.scoreChange)} · методика</small>}{!r.complete&&<small className="septRecalc">Диапазон, без места</small>}</td>{['care','services','readiness'].map(b=><td key={b} title={blockNames[b]}>{r.blocks[b]?r.blocks[b]!.complete?fmt(r.blocks[b]!.low):`${fmt(r.blocks[b]!.low)}–${fmt(r.blocks[b]!.high)}`:'Не прим.'}</td>)}<td><b>{r.available} / {r.total}</b><small className="septRecalc">{fmt(r.coverage,1)}%</small></td><td><span className={`septStatus ${r.status==='Лидер'?'leader':r.complete?'attention':'preliminary'}`}>{r.status}</span></td></tr>)}</tbody></table>{!visible.length&&<p className="septEmpty">МО по выбранным условиям не найдены</p>}</div>
  <p className="prototypeNote">Сравнение мест относится к двум версиям методики за сентябрь. Полнота проверяется по подтверждённому профилю МО. Архивная версия доступна переключателем сверху.</p>
 </section>;
}
