"use client";
import {useState} from 'react';
import data from './frmo-linkage-data.json';
import styles from './frmr-reconciliation.module.css';
type LinkRow=[string,string,string,string|null,string|null,number,number,string|null];
const rows=data.rows as LinkRow[];
const n=(x:number)=>x.toLocaleString('ru-RU');
const reasons=(flags:number)=>Object.entries(data.flags).filter(([bit])=>flags&Number(bit)).map(([,name])=>name);
export default function FrmoLinkage(){
 const [query,setQuery]=useState('');const [code,setCode]=useState<string|null>(null);const [flag,setFlag]=useState('issues');
 const orgs=data.organizations.filter(o=>`${o.name} ${o.code} ${o.parentOids.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.issues-a.issues||a.name.localeCompare(b.name,'ru'));
 const selected=data.organizations.find(o=>o.code===code);
 const detail=rows.filter(r=>r[0]===code&&(flag==='all' || (flag==='issues' ? r[5]>0 : Boolean(r[5]&Number(flag)))));
 return <section className={styles.panel} data-testid="frmo-linkage">
  <h2>Привязки подразделений к ФРМО · {data.cut}</h2>
  <p className={styles.muted}>Одна строка — отделение ГИС. Разные причины в одной строке не увеличивают итог. Различие наименований требует проверки справочника и не доказывает ошибку OID.</p>
  <div className={styles.miniStats}><article><small>Проверено отделений</small><b>{n(data.totals.rows)}</b></article><article><small>Строки с отклонениями</small><b className={styles.negative}>{n(data.totals.issues)}</b></article><article><small>Без выявленных отклонений</small><b>{n(data.totals.consistent)}</b></article><article><small>Пропущено в сводке исходника</small><b>{n(data.totals.missingSummaryRows)}</b><small>по {data.totals.missingSummaryCodes} кодам МО</small></article></div>
  <details className={styles.qualityNote}><summary>Как проверены данные и почему итог отличается от исходной сводки</summary><p>{data.method}</p><p>В сводке исходника {n(data.totals.sourceSummaryRows)} строк, в детализации {n(data.totals.rows)}. В столбце «Цвет» чередуются МО; это не признак ошибки. Столбец «Кол-во расх» считает строки подряд внутри МО, включая совпадающие привязки.</p><p>{data.comparison}</p><p>Источник: {data.source.name}</p><code>{data.source.sha256}</code></details>
  <div className={styles.filters}><input className={styles.input} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти МО, код или OID" aria-label="Поиск МО в привязках ФРМО"/><span className={styles.muted}>{orgs.length} МО в детализации</span></div>
  <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>МО</th><th>Отделений</th><th>С отклонениями</th><th>Контроль сводки</th></tr></thead><tbody>{orgs.map(o=><tr key={o.code}><td><button className={styles.clickName} onClick={()=>setCode(o.code)}>{o.name}</button><small className={styles.cellNote}>Код {o.code}</small></td><td>{n(o.rows)}</td><td>{n(o.issues)}</td><td>{o.summaryMissing?'Нет кода МО в сводке':'Состав строк сверён'}</td></tr>)}</tbody></table></div>
  {selected&&<section className={styles.linkageDetails}><h3>{selected.name}</h3><p className={styles.muted}>Родительские OID из привязок: {selected.parentOids.join('; ')||'не указаны'}</p>{selected.parentOids.length>1&&<p className={styles.qualityNote}>В одной МО присутствуют разные родительские OID. Требуется проверить действующие и исторические привязки; автоматически объединять их нельзя.</p>}<select className={styles.select} value={flag} onChange={e=>setFlag(e.target.value)} aria-label="Причина отклонения ФРМО"><option value="issues">Все строки с отклонениями</option><option value="all">Все отделения МО</option>{Object.entries(data.flags).map(([bit,label])=><option value={bit} key={bit}>{label}</option>)}</select><p className={styles.muted}>Найдено {detail.length} строк</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Строка</th><th>Филиал / отделение ГИС</th><th>OID СП у филиала</th><th>OID СП у отделения</th><th>Причины</th></tr></thead><tbody>{detail.map(r=><tr key={r[6]}><td>{r[6]}</td><td><b>{r[1]}</b><small className={styles.cellNote}>{r[2]}</small></td><td className={styles.oidCell}>{r[3]??'Не указан'}</td><td className={styles.oidCell}>{r[4]??'Не указан'}</td><td>{reasons(r[5]).join('; ')||'Отклонений по проверяемым полям нет'}{r[7]&&<small className={styles.cellNote}>Дата исключения СП: {r[7]}</small>}</td></tr>)}</tbody></table></div></section>}
 </section>;
}
