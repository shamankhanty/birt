"use client";

import { useMemo, useState } from "react";
import snapshots from "./vitrina-snapshots.json";
import "./vitrina-dashboard.css";
import VitrinaQualityDashboard, { OrganizationSignal } from "./vitrina-quality-dashboard";
import { findVitrinaQualityIssues } from "../lib/vitrina-quality.js";
import { getVitrinaIncident38 } from "./incident38-dashboard";
import { matchVitrinaOrganizations, summarizeVitrinaIssues, scheduleIdentity } from "../lib/vitrina-management.js";


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
type Incident = ReturnType<typeof getVitrinaIncident38>;
type IncidentOrg = Incident["organizations"][number];
type Issue = {id:string;category:string;level:"confirmed"|"review";field:string;original:string;instruction:string;unitName:string;reason:string};
type Entry = {id:string;name:string;source:ScopeRow|null;i38:IncidentOrg|null;issues:Issue[];matched:boolean};
type Filter = "all"|"issues"|"comma"|"empty"|"below"|"zero"|"unmatched";
type SortKey = "name"|"now"|"delta"|"coverage"|"gap"|"issues";
const pct = (n:number|null|undefined)=>n==null?"—":new Intl.NumberFormat("ru-RU",{maximumFractionDigits:1}).format(n)+"%";
const val = (n:number|null|undefined)=>n==null?"—":format(n);
const signed = (n:number|null|undefined)=>n==null?"—":(n>0?"+":"")+format(n);
const tone = (n:number|null|undefined)=>n==null?"v2Muted":n<60?"v2Bad":n<70?"v2Warn":"v2Good";
const short = (name:string)=>name.replace(/^(?:ГОСУДАРСТВЕННОЕ\s+АВТОНОМНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГОСУДАРСТВЕННОЕ\s+БЮДЖЕТНОЕ\s+УЧРЕЖДЕНИЕ\s+ЗДРАВООХРАНЕНИЯ|ГАУЗ|ГБУЗ)\s+/i,"").replace(/["«»]/g,"").replace(/\s+/g," ").trim();
const filters:{key:Filter;label:string}[]=[{key:"all",label:"Все МО"},{key:"below",label:"И-38 ниже 60%"},{key:"zero",label:"Профиль без слотов ЕПГУ"},{key:"issues",label:"С замечаниями"},{key:"comma",label:"Адрес начинается с запятой"},{key:"empty",label:"Пустые поля"},{key:"unmatched",label:"Без сопоставления"}];
const checkFilter=(e:Entry,f:Filter)=>f==="all" || (f==="issues"&&e.issues.length>0)||(f==="comma"&&Boolean(e.source?.rows.some(r=>r.address.trim().startsWith(","))))||(f==="empty"&&e.issues.some(i=>i.level==="confirmed"))||(f==="below"&&e.i38?.aggregate.coverage!=null&&e.i38.aggregate.coverage<60)||(f==="zero"&&(e.i38?.zero??0)>0)||(f==="unmatched"&&!e.matched);
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
  return <section className="v2Panel"><h2>Что исправить / проверить</h2>{entry.source?.now ? groups.filter(g=>g.rows.length).map(g=><details key={g.label} className="v2IssueGroup"><summary><span>{g.label}</span><strong>{g.rows.length}</strong></summary><p>{g.description}</p><div className="v2Sublist">{g.rows.map(i=><div key={i.id}><b>{i.unitName||"Без названия"}</b><span>{i.original}</span></div>)}</div></details>):<p className="v2Muted">Нет строк Витрины для этой МО в текущем срезе.</p>}
  {entry.source?.now && !entry.issues.length ? <p>По доступным полям замечаний не выявлено; качество слотов не проверено.</p>:null}
  <div className="v2SourceNote">Технические сигналы по слотам: длительность визита (столбец J) &gt;20 минут; 60+ — приоритет проверки. «Не принимает» (столбец H) — сверять со статусом слота. Количество и доля пока не определяются: исходник слотов не подключён.</div></section>;
}
function OrgWorkspace({entry,entries,choose,i38}:{entry:Entry|null;entries:Entry[];choose:(id:string)=>void;i38:Incident}) {
  const [query,setQuery]=useState("");
  const opts=entries.filter(e=>key(e.name).includes(key(query))||e.id===entry?.id);
  if(!entry)return <section className="v2Panel">Нет МО в выбранном периметре.</section>;
  const org=entry.i38,source=entry.source;
  const cells=org?.specialties.filter(s=>s.norm==null||s.norm>0||s.epguSlots==null||s.epguSlots>0).map(s=>({...s,p:s.norm!=null&&s.norm>0&&s.epguSlots!=null?s.epguSlots/s.norm*100:null,gap:s.norm!=null&&s.norm>0&&s.epguSlots!=null?Math.max(0,Math.ceil(s.norm*.7-s.epguSlots-1e-9)):null})).sort((a,b)=>(b.gap??-1)-(a.gap??-1))??[];
  return <div className="v2Workspace">
    <section className="v2Panel v2OrgPicker"><div><h2 title={entry.name}>{short(entry.name)}{!entry.source&&org?" · "+org.city:""}</h2><small>{entry.matched?"Предварительное сопоставление по названию и городу; OID Витрины отсутствует.":entry.source?"Нет подтверждённой связи с И-38.":"И-38: соответствие с Витриной не установлено."}</small></div><div className="v2Picker"><input aria-label="Поиск МО" placeholder="Поиск МО" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Выбрать МО" value={entry.id} onChange={e=>{choose(e.target.value);setQuery("");}}>{opts.map(e=><option key={e.id} value={e.id}>{short(e.name)}{!e.source&&e.i38?" · "+e.i38.city+" (И-38)":""}</option>)}</select></div></section>
    <div className="v2Metrics">
      <Metric label="Подразделения · Витрина" value={source?.now?val(source.now):"—"} hint={source?source.before+" → "+source.now+" строк; изменение "+signed(source.delta):"Нет сопоставления"}/>
      <Metric label="И-38.9" value={pct(org?.aggregate.coverage)} cls={tone(org?.aggregate.coverage)} hint={i38.dates.join(" / ")+" · "+val(org?.aggregate.epguSlots)+" из "+val(org?.aggregate.norm)}/>
      <Metric label="Дефицит до цели 70%" value={val(org?.gap)} cls={org?.gap?"v2Bad":""} hint="По профилям, без компенсации"/>
      <Metric label="Замечания Витрины" value={source?.now?val(entry.issues.length):"—"} hint={source?.now?entry.issues.filter(i=>i.level==="confirmed").length+" пустых полей":"Нет строк для проверки"} cls={entry.issues.length?"v2Warn":""}/>
      <Metric label="Свободные слоты / >20 мин" value="— / —" hint="Исходник слотов не загружен"/>
    </div>
    <div className="v2Columns"><section className="v2Panel"><h2>Доступность по специальностям <small>И-38 · {i38.dates.join(" / ")}</small></h2>{org?<><table className="v2Table v2Specialty"><thead><tr><th>Специальность</th><th>Норма</th><th>ЕПГУ</th><th>Доля</th><th>Дефицит 70%</th></tr></thead><tbody>{cells.map(s=><tr key={s.code}><td>{s.name}</td><td>{val(s.norm)}</td><td>{val(s.epguSlots)}</td><td className={tone(s.p)}>{pct(s.p)}</td><td className={s.gap?"v2Bad":""}>{val(s.gap)}</td></tr>)}</tbody></table><small className="v2Muted">План 60%, цель 70%. Нулевой норматив — не показатель невыполнения.</small></>:<p className="v2Muted">Нет безопасного сопоставления МО с И-38.</p>}</section><IssueGroups entry={entry}/></div>
    {source&&<details className="v2Panel"><summary>Подразделения и исходные адреса · {source.rows.length} строк</summary><div className="v2Sublist">{source.rows.map((r,i)=><div key={i}><b>{r.name||"Без названия"}</b><span>{r.address||"Адрес отсутствует"}</span></div>)}</div></details>}
  </div>;
}
function MinistryWorkspace({entries,scope,i38,open}:{entries:Entry[];scope:ScopeRow[];i38:Incident;open:(id:string)=>void}) {
  const [filter,setFilter]=useState<Filter>("all");const [query,setQuery]=useState("");const [sort,setSort]=useState<{key:SortKey;desc:boolean}>({key:"gap",desc:true});
  const changeSort=(k:SortKey)=>setSort(s=>({key:k,desc:s.key===k?!s.desc:k!=="name"&&k!=="coverage"}));
  const value=(e:Entry,k:SortKey):number|null=>k==="now"?e.source?.now??null:k==="delta"?e.source?.delta??null:k==="coverage"?e.i38?.aggregate.coverage??null:k==="gap"?e.i38?.gap??null:e.source?.now?e.issues.length:null;
  const filtered=entries.filter(e=>checkFilter(e,filter)&&key(e.name).includes(key(query))).sort((a,b)=>{if(sort.key==="name")return a.name.localeCompare(b.name,"ru")*(sort.desc?-1:1);const x=value(a,sort.key),y=value(b,sort.key);return x==null?y==null?0:1:y==null?-1:(sort.desc?y-x:x-y)||a.name.localeCompare(b.name,"ru");});
  const active=entries.filter(e=>e.source?.now);const issues=active.flatMap(e=>e.issues);
  const q=summarizeVitrinaIssues(scope.flatMap(r=>r.rows),issues);
  const now=scope.reduce((a,r)=>a+r.now,0),before=scope.reduce((a,r)=>a+r.before,0);
  const matched=entries.filter(e=>e.matched).length;
  const below=i38.organizations.filter(o=>o.aggregate.coverage!=null&&o.aggregate.coverage<60).length;
  const below70=i38.organizations.filter(o=>o.aggregate.coverage!=null&&o.aggregate.coverage<70).length;
  const zero=i38.organizations.filter(o=>o.zero>0).length;
  const specs=[...i38.specialties].sort((a,b)=>(b.gap??-1)-(a.gap??-1));
  const headers:{k:SortKey;label:string}[]=[{k:"name",label:"Медицинская организация"},{k:"now",label:"Подр."},{k:"delta",label:"Δ строк"},{k:"coverage",label:"И-38, %"},{k:"gap",label:"Дефицит 70%"},{k:"issues",label:"Замечания"}];
  const causeRows=[{name:"Адрес начинается с запятой",n:q.leadingComma,filter:"comma" as Filter,hint:active.filter(e=>checkFilter(e,"comma")).length+" МО · проверить общий механизм формирования"},{name:"Неоднозначные названия",n:q.names,filter:"issues" as Filter,hint:"Сверка с ФРМО"},{name:"Пустые поля",n:q.empty,filter:"empty" as Filter,hint:active.filter(e=>checkFilter(e,"empty")).length+" МО"},{name:"Другие адресные признаки",n:q.other,filter:"issues" as Filter,hint:"Требуют сверки"}];
  return <div className="v2Workspace">
    <div className="v2Metrics">
      <Metric label="МО с расписанием" value={val(active.length)} hint={"Подразделений: "+val(now)+" ("+signed(now-before)+")"}/>
      <Metric label="МО с замечаниями" value={val(active.filter(e=>e.issues.length).length)} hint={val(issues.length)+" замечаний · "+q.empty+" пустых поля"} cls="v2Warn" onClick={()=>setFilter("issues")}/>
      <Metric label="И-38.9 · "+i38.dates.join(" / ") value={pct(i38.total?.coverage)} cls={tone(i38.total?.coverage)} hint={val(i38.total?.epguSlots)+" / "+val(i38.total?.norm)+" · "+i38.orgCount+" МО"}/>
      <Metric label="МО ниже плана / цели" value={i38.comparable?below+" / "+below70:"—"} hint="И-38: 60% / 70%; "+zero+" МО с нулём слотов по профилю" cls="v2Bad" onClick={()=>setFilter("below")}/>
      <Metric label="Свободные слоты / >20 мин" value="— / —" hint="Витрина: источник слотов не подключён"/>
    </div>
    <div className="v2Columns">
      <section className="v2Panel"><h2>Приоритетные специальности <small>И-38 · дефицит до 70%</small></h2><div className="v2Bars">{specs.slice(0,5).map(s=><div key={s.code}><span>{s.name}</span><div className="v2Track"><i style={{width:Math.min(100,s.aggregate?.coverage??0)+"%",background:s.aggregate?.coverage==null?"#cbd5e1":s.aggregate.coverage<60?"#bc4651":s.aggregate.coverage<70?"#d49a35":"#269065"}}/></div><b className={tone(s.aggregate?.coverage)}>{pct(s.aggregate?.coverage)}</b><strong className="v2Bad">{val(s.gap)}</strong></div>)}</div><details><summary>Все 14 специальностей</summary><table className="v2Table v2Specialty"><thead><tr><th>Профиль</th><th>Норма</th><th>ЕПГУ</th><th>Доля</th><th>Дефицит</th></tr></thead><tbody>{specs.map(s=><tr key={s.code}><td>{s.name}</td><td>{val(s.aggregate?.norm)}</td><td>{val(s.aggregate?.epguSlots)}</td><td className={tone(s.aggregate?.coverage)}>{pct(s.aggregate?.coverage)}</td><td>{val(s.gap)}</td></tr>)}</tbody></table></details><small className="v2Muted">Сумма дефицитов по МО и профилям; избыток другого профиля не компенсирует недостаток.</small></section>
      <section className="v2Panel"><h2>Системные причины <small>Витрина · {snapshots.current.date}</small></h2>{causeRows.filter(c=>c.n>0).map(c=><button key={c.name} type="button" className="v2Cause" onClick={()=>setFilter(c.filter)}><div><b>{c.name}</b><small>{c.hint}</small></div><strong className={c.filter==="empty"?"v2Bad":"v2Warn"}>{c.n}</strong></button>)}<div className="v2SourceNote">Готовность перехода с ФЭР не оценена: отсутствуют проверенные слоты Витрины и сопоставимый срез. Адресные признаки не являются подтверждёнными нарушениями.</div></section>
    </div>
    <section className="v2Panel v2Registry"><div className="v2RegistryHead"><h2>МО · единый реестр <small>{filtered.length} из {entries.length} · {matched} предварительных связей</small></h2><div className="v2Filters"><input aria-label="Поиск МО" placeholder="Найти МО" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Фильтр МО" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>{filters.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></div></div>
      <div className="v2TableWrap"><table className="v2Table v2RegistryTable"><thead><tr>{headers.map(h=><th key={h.k} aria-sort={sort.key===h.k?(sort.desc?"descending":"ascending"):"none"}><button type="button" onClick={()=>changeSort(h.k)}>{h.label} {sort.key===h.k?(sort.desc?"↓":"↑"):"↕"}</button></th>)}<th>Своб. / &gt;20 мин</th></tr></thead><tbody>{filtered.map(e=><tr key={e.id}><td><button className="v2OrgLink" title={e.name} onClick={()=>open(e.id)}><OrganizationSignal issues={e.issues}/><span>{short(e.name)}{!e.source&&e.i38?" · "+e.i38.city:""}<small>{e.matched?"":e.source?"Без связи с И-38":"Только И-38"}</small></span></button></td><td>{e.source?.now?val(e.source.now):"—"}</td><td className={e.source?.delta==null?"v2Muted":e.source.delta>0?"v2Good":e.source.delta<0?"v2Bad":""}>{signed(e.source?.delta)}</td><td className={tone(e.i38?.aggregate.coverage)}>{pct(e.i38?.aggregate.coverage)}</td><td className={e.i38?.gap?"v2Bad":""}>{val(e.i38?.gap)}</td><td className={e.issues.length?"v2Warn":""}>{e.source?.now?val(e.issues.length):"—"}</td><td className="v2Muted">— / —</td></tr>)}</tbody></table>{!filtered.length&&<p className="v2Muted">Нет записей по выбранному фильтру.</p>}</div>
      <small className="v2Muted">Нажмите на МО для детализации. Δ — изменение числа строк, не слотов. Несопоставленные записи двух контуров показаны отдельно; число строк реестра не равно числу уникальных МО региона.</small>
    </section>
    <details className="v2Panel"><summary>Динамика расписаний · два среза</summary><div className="v2Columns">{[true,false].map(growth=><section key={String(growth)}><h3>{growth?"5 МО с наибольшим приростом":"5 МО с наибольшим снижением"}</h3>{scope.filter(r=>growth?r.delta>0:r.delta<0).sort((a,b)=>growth?b.delta-a.delta:a.delta-b.delta).slice(0,5).map(r=><div className="v2Cause" key={r.id}><button className="v2OrgLink" onClick={()=>open(r.id)}>{short(r.name)}</button><strong className={growth?"v2Good":"v2Bad"}>{signed(r.delta)}</strong></div>)}</section>)}</div><small className="v2Muted">Дата предыдущего среза отсутствует. Состав подразделений не верифицирован по OID.</small></details>
  </div>;
}
export default function VitrinaDashboard(){
  const [mode,setMode]=useState<"ministry"|"organization">("ministry");
  const [includePrivate,setIncludePrivate]=useState(false);
  const [selected,setSelected]=useState("");
  const scope=useMemo(()=>all.filter(r=>!isTechnical(r.name)&&(includePrivate||isState(r.name))),[includePrivate]);
  const i38=useMemo(()=>getVitrinaIncident38(includePrivate),[includePrivate]);
  const entries=useMemo(()=>{
    const links=new Map(matchVitrinaOrganizations(scope,i38.organizations).map(x=>[x.id,x.oid]));
    const byOid=new Map(i38.organizations.map(o=>[o.oid,o]));
    const used=new Set<string>();
    const vit:Entry[]=scope.map(r=>{const oid=links.get(r.id);const org=oid?byOid.get(oid)??null:null;if(org)used.add(org.oid);return {id:r.id,name:r.name,source:r,i38:org,issues:findVitrinaQualityIssues(r) as Issue[],matched:Boolean(org)}});
    return [...vit,...i38.organizations.filter(o=>!used.has(o.oid)).map(o=>({id:"i38:"+o.oid,name:o.name,source:null,i38:o,issues:[],matched:false} as Entry))];
  },[scope,i38]);
  const entry=entries.find(e=>e.id===selected)??entries.find(e=>e.matched)??entries[0]??null;
  const open=(id:string)=>{setSelected(id);setMode("organization");};
  return <section className="vitrinaQualityShell v2Shell">
    <header className="vitrinaQHeader"><div><h1>Витрина 2.0 — Запись к врачу</h1><p>Переход с ФЭР · доступность записи и качество расписаний</p></div><div className="vitrinaQHeaderRight"><time>Витрина: {snapshots.current.date}</time><label><input type="checkbox" checked={includePrivate} onChange={e=>setIncludePrivate(e.target.checked)}/> Все МО, включая частные</label></div></header>
    <nav className="v2Modes" aria-label="Рабочие режимы"><button type="button" aria-pressed={mode==="ministry"} onClick={()=>setMode("ministry")}>Минздрав РТ</button><button type="button" aria-pressed={mode==="organization"} onClick={()=>setMode("organization")}>Медицинская организация</button><span>И-38 · {i38.dates.join(" / ")} · {i38.horizons.join(" / ")} дней</span></nav>
    {mode==="ministry"?<MinistryWorkspace entries={entries} scope={scope} i38={i38} open={open}/>:<OrgWorkspace entry={entry} entries={entries} choose={setSelected} i38={i38}/>}
    <details className="v2Panel"><summary>Инструкция МО и методика</summary><VitrinaQualityDashboard organizations={scope} view="Инструкция МО" currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/><p className="v2Muted">Витрина: строки подразделений, дата текущей выгрузки {snapshots.current.date}. И-38: слоты ЕПГУ / общий норматив. Периметры источников различаются; связь по названию и городу предварительна. Дата выгрузки и дата визита не смешиваются. Значение длительности берётся из столбца J первичного источника; пропуски не считаются нулями.</p></details>
    <details className="v2Panel"><summary>Исключения и спорные случаи</summary><VitrinaQualityDashboard organizations={scope} view="Исключения" currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/></details>
  </section>;
}
