"use client";

import { useMemo, useState } from "react";
import snapshots from "./vitrina-snapshots.json";
import "./vitrina-dashboard.css";
import VitrinaQualityDashboard, { OrganizationSignal } from "./vitrina-quality-dashboard";
import { findVitrinaQualityIssues } from "../lib/vitrina-quality.js";
import { summarizeVitrinaIssues, scheduleIdentity } from "../lib/vitrina-management.js";


type Row = { parent: string; name: string; address: string };
const oldRows = snapshots.previous.rows as Row[];
const newRows = snapshots.current.rows as Row[];
const key = (value: string) => value.toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();
const parentKey = (value: string) => scheduleIdentity(key(value))
  .replace(/ ИМЕНИ М\.Ш\.УРАЗАЕВОЙ/, "")
  .replace(/ Г\. НАБЕРЕЖНЫЕ ЧЕЛНЫ$/, "")
  .replace(/ Г\. НАБЕРЕЖНЫЕ ЧЕЛНЫ(?=\")/, "")
  .replace(/"РЕСПУБЛИКАНСКАЯ СТОМАТОЛОГИЧЕСКАЯ/, "РЕСПУБЛИКАНСКАЯ СТОМАТОЛОГИЧЕСКАЯ")
  .replace(/ПОЛИКЛИНИКА МИНИСТЕРСТВА ЗДРАВООХРАНЕНИЯ РЕСПУБЛИКИ ТАТАРСТАН"/, "ПОЛИКЛИНИКА МИНИСТЕРСТВА ЗДРАВООХРАНЕНИЯ РЕСПУБЛИКИ ТАТАРСТАН");
const counts = (rows: Row[]) => {
  const map = new Map<string, { label: string; rows: Row[] }>();
  rows.forEach((row) => {
    const id = parentKey(row.parent);
    if (!map.has(id)) map.set(id, { label: row.parent, rows: [] });
    map.get(id)!.rows.push(row);
  });
  return map;
};
const previous = counts(oldRows);
const current = counts(newRows);
const names = new Set([...previous.keys(), ...current.keys()]);
const all = [...names].map((id) => ({
  id,
  name: current.get(id)?.label || previous.get(id)!.label,
  before: previous.get(id)?.rows.length ?? 0,
  now: current.get(id)?.rows.length ?? 0,
  rows: current.get(id)?.rows ?? [],
})).map((row) => ({ ...row, delta: row.now - row.before }));
const isState = (name: string) => /^(?:ГОСУДАРСТВЕННОЕ|ГАУЗ|ГБУЗ|ФЕДЕРАЛЬНОЕ|ФИЛИАЛ ГОСУДАРСТВЕННОГО)/i.test(name);
const isTechnical = (name: string) => /ТЕСТОВОЕ ЛПУ|НЕИЗВЕСТНАЯ МО/i.test(name);
const format = (number: number) => new Intl.NumberFormat("ru-RU").format(number);

type ScopeRow = typeof all[number];
type Issue = {id:string;category:string;level:"confirmed"|"review";field:string;original:string;instruction:string;unitName:string;reason:string};
type Entry = {id:string;name:string;source:ScopeRow;issues:Issue[]};
type Filter = "all"|"issues"|"comma"|"empty"|"names"|"other"|"growing"|"falling";
type SortKey = "name"|"before"|"now"|"delta"|"issues"|"confirmed";
const val = (n:number|null|undefined)=>n==null?"—":format(n);
const signed = (n:number|null|undefined)=>n==null?"—":(n>0?"+":"")+format(n);
const short = (name:string)=>name.replace(/^(?:ГОСУДАРСТВЕННОЕ\s+АВТОНОМНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГОСУДАРСТВЕННОЕ\s+БЮДЖЕТНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГАУЗ|ГБУЗ)\s+/i,"").replace(/["«»]/g,"").replace(/\s+/g," ").trim();
const filters:{key:Filter;label:string}[]=[{key:"all",label:"Все МО"},{key:"issues",label:"С замечаниями"},{key:"comma",label:"Адрес начинается с запятой"},{key:"empty",label:"Пустые поля"},{key:"names",label:"Наименования для сверки"},{key:"other",label:"Другие адресные признаки"},{key:"growing",label:"Прирост строк"},{key:"falling",label:"Снижение строк"}];
const checkFilter=(e:Entry,f:Filter)=>f==="all"||(f==="issues"&&e.issues.length>0)||(f==="comma"&&e.source.rows.some(r=>String(r.address??"").trim().startsWith(",")))||(f==="empty"&&e.issues.some(i=>i.level==="confirmed"))||(f==="names"&&e.issues.some(i=>i.category==="Наименования"&&i.level==="review"))||(f==="other"&&e.issues.some(i=>i.category==="Адреса"&&i.level==="review"&&!i.original.trim().startsWith(",")))||(f==="growing"&&e.source.delta>0)||(f==="falling"&&e.source.delta<0);
function Metric({label,value,hint,cls="",onClick}:{label:string;value:string;hint:string;cls?:string;onClick?:()=>void}) {
  const body=<><span>{label}</span><strong className={cls}>{value}</strong><small>{hint}</small></>;
  return onClick?<button type="button" className="v2Metric v2MetricAction" onClick={onClick}>{body}</button>:<article className="v2Metric">{body}</article>;
}
function IssueGroups({entry}:{entry:Entry}) {
  const groups=[
    {label:"Адрес начинается с запятой",description:"Проверить индекс, источник адреса ФРМО/ГАР и формирование строки в ГИС ЭЗ РТ.",rows:entry.issues.filter(i=>i.category==="Адреса"&&i.level==="review"&&i.original.trim().startsWith(","))},
    {label:"Отсутствующие поля",description:"Заполнить исходные поля по реестру.",rows:entry.issues.filter(i=>i.level==="confirmed")},
    {label:"Наименования для сверки",description:"Сверить отображаемое наименование подразделения с ФРМО.",rows:entry.issues.filter(i=>i.category==="Наименования"&&i.level==="review")},
    {label:"Прочие адресные признаки",description:"Сверить адрес по ФРМО/ГАР.",rows:entry.issues.filter(i=>i.category==="Адреса"&&i.level==="review"&&!i.original.trim().startsWith(","))}
  ];
  return <section className="v2Panel"><h2>Что исправить / проверить</h2>{entry.source?.now ? groups.filter(g=>g.rows.length).map(g=><details open key={g.label} className="v2IssueGroup"><summary><span>{g.label}</span><strong>{g.rows.length}</strong></summary><p>{g.description}</p><div className="v2Sublist">{g.rows.map(i=><div key={i.id}><b>{i.unitName||"Без названия"}</b><span>{i.original}</span></div>)}</div></details>):<p className="v2Muted">Нет строк Витрины для этой МО в текущем срезе.</p>}
  {entry.source?.now && !entry.issues.length ? <p>По доступным полям замечаний не выявлено; качество слотов не проверено.</p>:null}
  <div className="v2SourceNote">Технические сигналы по слотам: длительность визита (столбец J) &gt;20 минут; 60+ — приоритет проверки. «Не принимает» (столбец H) — сверять со статусом слота. Количество и доля пока не определяются: исходник слотов не подключён.</div></section>;
}

function OrgWorkspace({entry,entries,choose}:{entry:Entry|null;entries:Entry[];choose:(id:string)=>void}) {
  const [query,setQuery]=useState("");
  const opts=entries.filter(e=>key(e.name).includes(key(query))||e.id===entry?.id);
  if(!entry)return <section className="v2Panel">Нет МО в выбранном периметре.</section>;
  const source=entry.source;
  return <div className="v2Workspace">
    <section className="v2Panel v2OrgPicker"><div><h2 title={entry.name}>{short(entry.name)}</h2><small>Срез расписаний: {snapshots.current.date}</small></div><div className="v2Picker"><input aria-label="Поиск МО" placeholder="Поиск МО" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Выбрать МО" value={entry.id} onChange={e=>{choose(e.target.value);setQuery("");}}>{opts.map(e=><option key={e.id} value={e.id}>{short(e.name)}</option>)}</select></div></section>
    <div className="v2Metrics">
      <Metric label="Строки подразделений" value={val(source.now)} hint={"Предыдущий срез: "+val(source.before)}/>
      <Metric label="Изменение строк" value={signed(source.delta)} cls={source.delta>0?"v2Good":source.delta<0?"v2Bad":""} hint="Предыдущий срез без даты"/>
      <Metric label="Замечания" value={source.now?val(entry.issues.length):"—"} hint="По доступным полям" cls={entry.issues.length?"v2Warn":""}/>
      <Metric label="Пустые поля" value={source.now?val(entry.issues.filter(i=>i.level==="confirmed").length):"—"} cls={entry.issues.some(i=>i.level==="confirmed")?"v2Bad":""} hint="Подтверждено в выгрузке"/>
      <Metric label="Свободные слоты / >20 мин" value="— / —" hint="Исходник слотов не загружен"/>
    </div>
    <div className="v2Columns"><IssueGroups entry={entry}/><section className="v2Panel"><h2>Подразделения и исходные адреса <small>{source.rows.length} строк</small></h2><div className="v2Sublist">{source.rows.map((r,i)=><div key={i}><b>{r.name||"Без названия"}</b><span>{r.address||"Адрес отсутствует"}</span></div>)}</div><small className="v2Muted">Наличие строки не подтверждает доступность записи.</small></section></div>
  </div>;
}
function MinistryWorkspace({entries,scope,open}:{entries:Entry[];scope:ScopeRow[];open:(id:string)=>void}) {
  const [filter,setFilter]=useState<Filter>("all");const [query,setQuery]=useState("");const [sort,setSort]=useState<{key:SortKey;desc:boolean}>({key:"issues",desc:true});
  const changeSort=(k:SortKey)=>setSort(s=>({key:k,desc:s.key===k?!s.desc:k!=="name"}));
  const value=(e:Entry,k:SortKey):number|null=>k==="before"?e.source.before:k==="now"?e.source.now:k==="delta"?e.source.delta:k==="confirmed"?e.source.now?e.issues.filter(i=>i.level==="confirmed").length:null:e.source.now?e.issues.length:null;
  const filtered=entries.filter(e=>checkFilter(e,filter)&&key(e.name).includes(key(query))).sort((a,b)=>{if(sort.key==="name")return a.name.localeCompare(b.name,"ru")*(sort.desc?-1:1);const x=value(a,sort.key),y=value(b,sort.key);return x==null?y==null?0:1:y==null?-1:(sort.desc?y-x:x-y)||a.name.localeCompare(b.name,"ru");});
  const active=entries.filter(e=>e.source.now>0);const issues=active.flatMap(e=>e.issues);
  const q=summarizeVitrinaIssues(scope.flatMap(r=>r.rows),issues);
  const now=scope.reduce((a,r)=>a+r.now,0),before=scope.reduce((a,r)=>a+r.before,0);
  const growing=scope.filter(r=>r.delta>0).length,falling=scope.filter(r=>r.delta<0).length;
  const headers:{k:SortKey;label:string}[]=[{k:"name",label:"Медицинская организация"},{k:"before",label:"Было"},{k:"now",label:"Стало"},{k:"delta",label:"Δ строк"},{k:"issues",label:"Замечания"},{k:"confirmed",label:"Пустые поля"}];
  const causeRows=[{name:"Адрес начинается с запятой",n:q.leadingComma,filter:"comma" as Filter,hint:active.filter(e=>checkFilter(e,"comma")).length+" МО · проверить общий механизм формирования"},{name:"Неоднозначные названия",n:q.names,filter:"names" as Filter,hint:"Сверка с ФРМО"},{name:"Пустые поля",n:q.empty,filter:"empty" as Filter,hint:active.filter(e=>checkFilter(e,"empty")).length+" МО"},{name:"Другие адресные признаки",n:q.other,filter:"other" as Filter,hint:"Требуют сверки"}];
  return <div className="v2Workspace">
    <div className="v2Metrics">
      <Metric label="МО с расписанием" value={val(active.length)} hint={"Предыдущий срез: "+val(scope.filter(r=>r.before>0).length)}/>
      <Metric label="Строки подразделений" value={val(now)} hint={val(before)+" → "+val(now)+" · "+signed(now-before)}/>
      <Metric label="МО с замечаниями" value={val(active.filter(e=>e.issues.length).length)} hint={val(issues.length)+" замечаний · "+q.empty+" пустых поля"} cls="v2Warn" onClick={()=>setFilter("issues")}/>
      <Metric label="МО с приростом / снижением" value={growing+" / "+falling} hint="Изменение числа строк двух срезов"/>
      <Metric label="Свободные слоты / >20 мин" value="— / —" hint="Витрина: источник слотов не подключён"/>
    </div>
    <div className="v2Columns">
      <section className="v2Panel"><h2>Динамика расписаний <small>два среза</small></h2><div className="v2Columns">{[true,false].map(growth=><div key={String(growth)}><h3>{growth?"5 МО с наибольшим приростом":"5 МО с наибольшим снижением"}</h3>{scope.filter(r=>growth?r.delta>0:r.delta<0).sort((a,b)=>growth?b.delta-a.delta:a.delta-b.delta).slice(0,5).map(r=><div className="v2Cause" key={r.id}><button className="v2OrgLink" onClick={()=>open(r.id)}>{short(r.name)}</button><strong className={growth?"v2Good":"v2Bad"}>{signed(r.delta)}</strong></div>)}</div>)}</div><small className="v2Muted">Дата предыдущего среза отсутствует. Динамика строк не равна динамике слотов.</small></section>
      <section className="v2Panel"><h2>Признаки для проверки <small>Витрина · {snapshots.current.date}</small></h2>{causeRows.filter(c=>c.n>0).map(c=><button key={c.name} type="button" className="v2Cause" onClick={()=>setFilter(c.filter)}><div><b>{c.name}</b><small>{c.hint}</small></div><strong className={c.filter==="empty"?"v2Bad":"v2Warn"}>{c.n}</strong></button>)}<div className="v2SourceNote">Готовность перехода с ФЭР не оценена: отсутствует проверенная выгрузка слотов Витрины. Адресные признаки не являются подтверждёнными нарушениями.</div></section>
    </div>
    <section className="v2Panel v2Registry"><div className="v2RegistryHead"><h2>МО · единый реестр <small>{filtered.length} из {entries.length}</small></h2><div className="v2Filters"><input aria-label="Поиск МО" placeholder="Найти МО" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Фильтр МО" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>{filters.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></div></div>
      <div className="v2TableWrap"><table className="v2Table v2RegistryTable"><thead><tr>{headers.map(h=><th key={h.k} aria-sort={sort.key===h.k?(sort.desc?"descending":"ascending"):"none"}><button type="button" onClick={()=>changeSort(h.k)}>{h.label} {sort.key===h.k?(sort.desc?"↓":"↑"):"↕"}</button></th>)}<th>Своб. / &gt;20 мин</th></tr></thead><tbody>{filtered.map(e=><tr key={e.id}><td><button className="v2OrgLink" title={e.name} onClick={()=>open(e.id)}><OrganizationSignal issues={e.issues}/><span>{short(e.name)}</span></button></td><td>{val(e.source.before)}</td><td>{val(e.source.now)}</td><td className={e.source.delta>0?"v2Good":e.source.delta<0?"v2Bad":""}>{signed(e.source.delta)}</td><td className={e.issues.length?"v2Warn":""}>{e.source.now?val(e.issues.length):"—"}</td><td className={e.issues.some(i=>i.level==="confirmed")?"v2Bad":""}>{e.source.now?val(e.issues.filter(i=>i.level==="confirmed").length):"—"}</td><td className="v2Muted">— / —</td></tr>)}</tbody></table>{!filtered.length&&<p className="v2Muted">Нет записей по выбранному фильтру.</p>}</div>
      <small className="v2Muted">Нажмите на МО для детализации. Δ — изменение числа строк, не слотов. В реестре только МО из двух выгрузок Витрины; охват всех МО республики не оценён.</small>
    </section>
  </div>;
}
export default function VitrinaDashboard(){
  const [mode,setMode]=useState<"ministry"|"organization">("ministry");
  const [includePrivate,setIncludePrivate]=useState(false);
  const [selected,setSelected]=useState("");
  const scope=useMemo(()=>all.filter(r=>!isTechnical(r.name)&&(includePrivate||isState(r.name))),[includePrivate]);
  const entries=useMemo(()=>scope.map(r=>({id:r.id,name:r.name,source:r,issues:findVitrinaQualityIssues(r) as Issue[]})),[scope]);
  const entry=entries.find(e=>e.id===selected)??entries.find(e=>e.source.now>0)??entries[0]??null;
  const open=(id:string)=>{setSelected(id);setMode("organization");};
  return <section className="vitrinaQualityShell v2Shell">
    <header className="vitrinaQHeader"><div><h1>Витрина 2.0 — Запись к врачу</h1><p>Переход с ФЭР · доступность записи и качество расписаний</p></div><div className="vitrinaQHeaderRight"><time>Витрина: {snapshots.current.date}</time><label><input type="checkbox" checked={includePrivate} onChange={e=>setIncludePrivate(e.target.checked)}/> Все МО, включая частные</label></div></header>
    <nav className="v2Modes" aria-label="Рабочие режимы"><button type="button" aria-pressed={mode==="ministry"} onClick={()=>setMode("ministry")}>Минздрав РТ</button><button type="button" aria-pressed={mode==="organization"} onClick={()=>setMode("organization")}>Медицинская организация</button></nav>
    {mode==="ministry"?<MinistryWorkspace entries={entries} scope={scope} open={open}/>:<OrgWorkspace entry={entry} entries={entries} choose={setSelected}/>}
    <details open className="v2Panel"><summary>Инструкция МО и методика</summary><VitrinaQualityDashboard organizations={scope} view="Инструкция МО" currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/><p className="v2Muted">Витрина: строки подразделений, дата текущей выгрузки {snapshots.current.date}. Дата выгрузки и дата визита не смешиваются. Значение длительности берётся из столбца J первичного источника; пропуски не считаются нулями.</p></details>
    <details open className="v2Panel"><summary>Исключения и спорные случаи</summary><VitrinaQualityDashboard organizations={scope} view="Исключения" currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/></details>
  </section>;
}
