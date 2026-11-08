"use client";

import {useMemo, useState} from 'react';
import inputs from './rating/september-v2-inputs.json';
import legacy from './rating/september-v1.json';
import policy from '../config/september-rating-v2.json';
import {buildSeptemberRating, metricScore} from '../lib/september-rating.js';

const fmt = (v:number|null|undefined, d=2) =>
  v == null ? '—' : (Math.abs(v)<0.005 ? 0 : v).toLocaleString('ru-RU',{maximumFractionDigits:d,minimumFractionDigits:0});
const blockNames:Record<string,string> = {
  care:'Медицинская помощь',
  services:'Цифровые услуги',
  readiness:'Готовность',
};
const blockWeights:Record<string,string> = {care:'70%',services:'20%',readiness:'10%'};

export default function SeptemberRating(){
  const rows=useMemo(()=>buildSeptemberRating(inputs,legacy,policy),[]);
  const types=[...new Set(rows.map(r=>r.type))];
  const [type,setType]=useState('Центральные районные больницы');
  const [query,setQuery]=useState('');
  const [onlyMissing,setOnlyMissing]=useState(false);
  const group=rows.filter(r=>r.type===type);
  const rankedGroup=group.filter(r=>r.complete&&r.place!==null).sort((a,b)=>(a.place??999)-(b.place??999)||a.name.localeCompare(b.name,'ru'));
  const topBest=rankedGroup.slice(0,5);
  const topWorst=[...rankedGroup].slice(-5).reverse();
  const visible=group
    .filter(r=>(!onlyMissing||!r.complete)&&`${r.name} ${r.key}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
    .sort((a,b)=>(a.place??999)-(b.place??999)||a.name.localeCompare(b.name,'ru'));
  const blockValue=(r:typeof rows[number], block:string)=>{
    const value=r.blocks[block];
    return value ? value.complete ? fmt(value.low) : `${fmt(value.low)}–${fmt(value.high)}` : 'Не применяется';
  };

  return <section className="septemberRating" aria-label="Сентябрьский рейтинг по новой методике">
    <div className="pageHead ratingHead">
      <div>
        <p className="eyebrow">ПЕРЕСЧЁТ МЕТОДИКИ · ВЕРСИЯ 2</p>
        <h1>Месячный рейтинг МО — сентябрь 2026</h1>
        <p>Места внутри типа МО · прежняя версия сохранена · изменение балла не является динамикой работы</p>
      </div>
      <div className="ratingFormula"><small>Закрытый период</small><strong>Сентябрь 2026</strong><span>Октябрьские данные исключены</span></div>
    </div>
    <details className="septMethod">
      <summary>Методика, периоды и ограничения</summary>
      <div className="septMethodBody">
        <p><b>70% — медицинская помощь, 20% — цифровые услуги, 10% — готовность.</b> Каждый показатель: факт / план × 100, максимум 100 баллов. Перевыполнение не даёт дополнительных баллов.</p>
        <p>В готовности: ТВСП — 50%, активность врачей — 25%, группа специальностей 500+ — 25%. Внутри групп показатели равновесны. Неприменимые по подтверждённому профилю показатели и нулевые знаменатели исключаются; их веса перераспределяются в пределах группы, затем блока.</p>
        <p><b>Официальное место — только при полном обязательном наборе.</b> При пропусках показан диапазон возможного балла и перечень недостающих данных. Пропуск не считается фактом 0 и не улучшает место. «Лидер» — от 95 баллов, если каждый ключевой показатель помощи выполнен хотя бы на 80% своего плана.</p>
        <p><b>Периоды:</b> врачи и ЕПГУ — 01.09–30.09; СЭМД и ТВСП — накопительно 01.01–30.09. Это оценка состояния на сентябрьском срезе, а не месячный поток СЭМД. РЭМД сформирован 30.09 в 14:44; более поздний сентябрьский результат не подразумевается.</p>
        <p>СЭМД профилактики = MAX(122; 228) / случаи ФОМС. Стационарные эпикризы = (выписной эпикриз + эпикриз роддома) / случаи ОМС из одного отчёта. ЕПГУ: финальный статус / заявления и обработка за 2 рабочих дня / заявления.</p>
        <p>{inputs.profileRule}</p>
        <ul>{inputs.exclusions.map(e=><li key={e.id}>{e.reason}</li>)}</ul>
        <p>Равные баллы дают одинаковое место. Изменение состава допущенных МО также меняет место, поэтому стрелки роста и падения здесь не используются. Объединения доступны в прежней версии; их методика этим пересчётом не изменена.</p>
        <details><summary>Исходники и контрольные суммы</summary>{Object.values(inputs.sources).map(s=><p key={s.sha256} className="septSource">{s.file}<br/><code>{s.sha256}</code></p>)}<p>Кадры и ТВСП — зафиксированные сентябрьские наборы; контрольные суммы сохранены в версии расчёта.</p></details>
      </div>
    </details>
    <div className="ratingTypeTabs septTypeTabs" role="group" aria-label="Тип медицинской организации">
      {types.map(t=><button key={t} className={type===t?'active':''} onClick={()=>setType(t)}>{t}<small>{rows.filter(r=>r.type===t).length}</small></button>)}
    </div>
    <div className="septStats">
      <article><small>МО в группе</small><strong>{group.length}</strong></article>
      <article><small>Получили место</small><strong>{group.filter(r=>r.complete).length}</strong></article>
      <article><small>Предварительно</small><strong>{group.filter(r=>!r.complete).length}</strong></article>
      <article><small>Лидеры</small><strong>{group.filter(r=>r.status==='Лидер').length}</strong></article>
    </div>
    <section className="septTopLists" aria-label={`Топ-5 лучших и худших МО: ${type}`}>
      {[{title:'Топ‑5 лучших',items:topBest,kind:'best'},{title:'Топ‑5 худших',items:topWorst,kind:'worst'}].map(list=>
        <article className={`septTopList ${list.kind}`} key={list.kind}>
          <h2>{list.title}<small>{type}</small></h2>
          <ol>{list.items.map(r=><li key={r.key}>
            <span className="septTopPlace">{r.place}</span>
            <span className="septTopName">{r.name}</span>
            <b>{fmt(r.score)}<small>балла</small></b>
          </li>)}</ol>
        </article>
      )}
      <p>Показаны только МО с официальным местом в выбранной группе. Предварительные оценки без полного набора данных остаются в общем списке.</p>
    </section>
    <div className="septTools">
      <input aria-label="Найти МО в сентябрьском рейтинге" placeholder="Найти МО или OID" value={query} onChange={e=>setQuery(e.target.value)}/>
      <label><input type="checkbox" checked={onlyMissing} onChange={e=>setOnlyMissing(e.target.checked)}/> Только с неполными данными</label>
      <span className="septVisibleCount">{visible.length} МО</span>
    </div>
    <div className="septCards">
      {visible.map(r=>{
        const reason=r.missing.length
          ? `Не хватает обязательных данных: ${r.missing.slice(0,2).map(m=>m.name).join('; ')}${r.missing.length>2?` и ещё ${r.missing.length-2}`:''}.`
          : r.critical.length
            ? `Лидерство ограничивает показатель: ${r.critical[0].name}.`
            : r.status==='Лидер'
              ? 'Ключевые условия лидерства выполнены.'
              : 'Баллы пересчитаны по закрытому сентябрьскому срезу.';
        return <article className={`septCard ${r.complete?r.status==='Лидер'?'leader':'rated':'preliminary'}`} key={r.key}>
          <div className="septCardHead">
            <span className="septPlace" aria-label={r.place===null?'Без официального места':`Место ${r.place}`}>{r.place??'—'}</span>
            <div className="septCardIdentity">
              <h2>{r.name}</h2>
              <small>{r.key.startsWith('context:')?'OID требует подтверждения':r.key} · {r.type}</small>
            </div>
            <div className="septCardScore">
              <strong>{r.complete?fmt(r.score):r.low===null?'—':`${fmt(r.low)}–${fmt(r.high)}`}</strong>
              <small>{r.complete?'баллов из 100':'диапазон, без места'}</small>
            </div>
            <span className={`septStatus ${r.status==='Лидер'?'leader':r.complete?'attention':'preliminary'}`}>{r.status}</span>
          </div>
          <div className="septCardSignals">
            <p><small>Место · было → стало</small><b>{r.oldPlace??'—'} → {r.place??'—'}</b></p>
            <p><small>Балл · было → стало</small><b>{fmt(r.oldScore)} → {r.complete?fmt(r.score):r.low===null?'—':`${fmt(r.low)}–${fmt(r.high)}`}</b><span>изменение методики</span></p>
            {(['care','services','readiness'] as const).map(block=><p key={block}><small>{blockNames[block]} · {blockWeights[block]}</small><b>{blockValue(r,block)}</b></p>)}
            <p><small>Полнота обязательных</small><b>{r.available} из {r.total}</b><span>{fmt(r.coverage,1)}%</span></p>
          </div>
          <div className="septCardReason"><small>Итог оценки</small><b>{reason}</b></div>
          <details className="septCardDetails">
            <summary>Показатели МО ({r.available} из {r.total} с данными) и причины пересчёта</summary>
            <div>
              <div className="septReasons">
                <strong>Пересчёт того же сентября</strong>
                <ul>{r.reasons.map((text,i)=><li key={i}>{text}</li>)}</ul>
                {r.missing.length>0&&<p><b>Нет данных:</b> {r.missing.map(m=>m.name).join('; ')}.</p>}
              </div>
              {Object.entries(blockNames).map(([block,label])=>{
                const metrics=r.metrics.filter(m=>m.block===block);
                return metrics.length>0&&<section className="septMetricGroup" key={block}>
                  <h3>{label} · {blockWeights[block]}</h3>
                  {metrics.map(m=><div className={`septMetric ${m.status==='available'?(m.fact!==null&&m.fact>=m.plan?'good':'bad'):m.status}`} key={m.id}>
                    <div><b>{m.name}</b><small>{m.period} · {m.periodKind==='monthly'?'за месяц':'накопительно'}</small>{m.mappingNote&&<small>{m.mappingNote}</small>}{m.s122!==undefined&&<small>122: {fmt(m.s122,0)} · 228: {fmt(m.s228,0)} · взят максимум</small>}</div>
                    <strong>{m.status==='available'?<>{fmt(m.numerator,0)} из {fmt(m.denominator,0)} · {fmt(m.fact)}%<small>план {fmt(m.plan)}% · {fmt(metricScore(m))} балла</small></>:m.status==='not_applicable'?'Не применяется: нулевой знаменатель':'Нет подтверждённых данных'}</strong>
                  </div>)}
                </section>;
              })}
            </div>
          </details>
        </article>;
      })}
      {!visible.length&&<p className="septEmpty">МО по выбранным условиям не найдены</p>}
    </div>
    <p className="prototypeNote">Сравнение мест относится к двум версиям методики за сентябрь. Полнота проверяется по подтверждённому профилю МО. Архивная версия доступна переключателем сверху.</p>
  </section>;
}
