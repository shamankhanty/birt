"use client";

import { useMemo, useState } from "react";
import snapshots from "./vitrina-snapshots.json";
import { sortVitrinaRows, type VitrinaSortColumn, type VitrinaSortDirection } from "../lib/vitrina-sort.js";
import "./vitrina-dashboard.css";
import VitrinaQualityDashboard, { OrganizationSignal, type VitrinaQualityTab } from "./vitrina-quality-dashboard";
import { buildVitrinaQuality, findVitrinaQualityIssues } from "../lib/vitrina-quality.js";
import { getVitrinaIncident38 } from "./incident38-dashboard";


type Row = { parent: string; name: string; address: string };
const oldRows = snapshots.previous.rows as Row[];
const newRows = snapshots.current.rows as Row[];
const key = (value: string) => value.toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();
const parentKey = (value: string) => key(value)
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
const specialties = ["врач-терапевт участковый", "врач общей практики (семейный врач)", "врач-хирург", "врач-офтальмолог", "врач-оториноларинголог", "врач-акушер-гинеколог", "врач-психиатр-нарколог", "врач-фтизиатр", "врач-стоматолог", "врач-стоматолог-терапевт", "врач-педиатр участковый", "врач-детский хирург", "врач-стоматолог детский", "врач-психиатр детский (подростковый)"];

function VitrinaPresence({ includePrivate, dynamics }: { includePrivate: boolean; dynamics: boolean }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: VitrinaSortColumn; direction: VitrinaSortDirection }>({ column: "delta", direction: "asc" });
  const changeSort = (column: VitrinaSortColumn) => setSort((previous) => ({
    column,
    direction: previous.column === column
      ? (previous.direction === "asc" ? "desc" : "asc")
      : (column === "name" || column === "delta" ? "asc" : "desc"),
  }));
  const sortIndicator = (column: VitrinaSortColumn) =>
    sort.column === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  const ariaSort = (column: VitrinaSortColumn): "ascending" | "descending" | "none" =>
    sort.column === column ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const [selected, setSelected] = useState<string | null>(null);
  const scope = useMemo(() => all.filter((row) => !isTechnical(row.name) && (includePrivate || isState(row.name))), [includePrivate]);
  const filtered = useMemo(() => sortVitrinaRows(
    scope.filter((row) => key(row.name).includes(key(query))),
    sort.column,
    sort.direction,
  ), [scope, query, sort]);
  const before = scope.reduce((sum, row) => sum + row.before, 0);
  const now = scope.reduce((sum, row) => sum + row.now, 0);
  const growing = scope.filter((row) => row.delta > 0).length;
  const falling = scope.filter((row) => row.delta < 0).length;
  const chosen = scope.find((row) => row.id === selected);
  return <section className="vitrina">
    <div className="vitrinaCards">
      <article><span>МО с расписанием</span><strong>{format(scope.filter((r) => r.now > 0).length)}</strong><small>предыдущий срез: {format(scope.filter((r) => r.before > 0).length)}</small></article>
      <article><span>Подразделения</span><strong>{format(now)}</strong><small>{format(before)} → {format(now)} · {now - before >= 0 ? "+" : ""}{format(now - before)}</small></article>
      <article><span>МО с приростом</span><strong className="positive">{growing}</strong><small>по числу подразделений</small></article>
      <article><span>МО со снижением</span><strong className="negative">{falling}</strong><small>требуют сверки состава</small></article>
    </div>
    <p className="vitrinaNotice">Показано наличие расписаний в выгрузке, а не число свободных слотов. Дата предыдущего среза в файле отсутствует; изменение названий МО и подразделений требует проверки.</p>
    <details className="vitrinaGuide"><summary>Что сделать МО · инструкция по корректировке данных на ЕПГУ</summary><ol><li>Сверить наименование МО с ФРМО и исправить расхождения в расписании Витрины.</li><li>Сверить адрес с ФРМО и заполнить все поля адреса.</li><li>Привести расписание врачей в соответствие с инструкциями разработчика ГИС ЭЗ РТ. Открыть слоты для записи граждан по применимым базовым специальностям; названия специальностей указывать полностью, как в ФРМО, без сокращений.</li></ol><details><summary>Перечень 14 базовых специальностей</summary><ul>{specialties.map((name) => <li key={name}>{name}</li>)}</ul></details><p>Другие специальности допустимы при подтверждении, что помощь без направления предусмотрена территориальной программой государственных гарантий или бюджетом региона. Конкретные замечания МО следует брать из приложенного к инструкции перечня ошибочных наименований; в этих двух выгрузках перечня нет.</p><small>Источник: «Инструкция для МО 19.11.2026.docx». Наличие строки расписания само по себе не подтверждает исполнение этих требований.</small></details>
    {dynamics && <div className="vitrinaQColumns">{[true,false].map(growth => <section className="vitrinaQPanel" key={String(growth)}><h2>{growth ? "5 МО с наибольшим приростом" : "5 МО с наибольшим снижением"}</h2>{[...scope].filter(row => growth ? row.delta > 0 : row.delta < 0).sort((a,b) => growth ? b.delta-a.delta : a.delta-b.delta).slice(0,5).map(row => <div className="vitrinaQExceptionRow" key={row.id}><b>{row.name}</b><strong className={growth ? "vitrinaMPositive" : "vitrinaMNegative"}>{growth ? "+" : ""}{row.delta}</strong></div>)}<small className="vitrinaQMuted">Изменение числа строк подразделений, не числа слотов.</small></section>)}</div>}
    <div className="vitrinaToolbar"><h2>{dynamics ? "Динамика по МО" : "Наличие расписаний — рейтинг по изменению числа подразделений"}</h2><input aria-label="Поиск МО" placeholder="Найти МО" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="vitrinaSortHint">Сортировка — нажатием на заголовок столбца</span></div>
    <div className="vitrinaTableWrap"><table><thead><tr>
      <th aria-sort={ariaSort("name")}><button type="button" className="vitrinaSortButton" onClick={() => changeSort("name")}>МО <span aria-hidden="true">{sortIndicator("name")}</span></button></th>
      <th aria-sort={ariaSort("before")}><button type="button" className="vitrinaSortButton" onClick={() => changeSort("before")}>Было <span aria-hidden="true">{sortIndicator("before")}</span></button></th>
      <th aria-sort={ariaSort("now")}><button type="button" className="vitrinaSortButton" onClick={() => changeSort("now")}>Стало <span aria-hidden="true">{sortIndicator("now")}</span></button></th>
      <th aria-sort={ariaSort("delta")}><button type="button" className="vitrinaSortButton" onClick={() => changeSort("delta")}>Изменение <span aria-hidden="true">{sortIndicator("delta")}</span></button></th>
    </tr></thead><tbody>{filtered.map((row) => <tr key={row.id} onClick={() => setSelected(row.id)} className={selected === row.id ? "selected" : ""}><td><span className="vitrinaQOrgCell"><OrganizationSignal issues={findVitrinaQualityIssues(row)}/><span>{row.name}</span></span></td><td>{row.before}</td><td>{row.now}</td><td className={row.delta > 0 ? "positive" : row.delta < 0 ? "negative" : ""}>{row.delta > 0 ? "+" : ""}{row.delta}</td></tr>)}</tbody></table></div>
    {chosen && <section className="vitrinaDetail"><div><h2>{chosen.name}</h2><button onClick={() => setSelected(null)}>Закрыть</button></div><p>Подразделений: {chosen.before} → {chosen.now}. Состав нового среза:</p><ul>{chosen.rows.map((row, index) => <li key={`${row.name}-${row.address}-${index}`}><strong>{row.name}</strong><span>{row.address || "Адрес не указан"}</span></li>)}</ul></section>}
    <small className="vitrinaSource">Источник: «МО_ у которых есть расписание (1).xlsx» и «МО с расписаниями на 23.11.xlsx». Единица учёта — строка подразделения.</small>
  </section>;
}



type ManagementTab = VitrinaQualityTab | "Сводка МЗ" | "Рейтинг МО" | "Специальности" | "Сопоставление с И-38";
type ScopeRow = typeof all[number];
const pct = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("ru-RU",{maximumFractionDigits:1}).format(n)+"%";
const val = (n: number | null | undefined) => n == null ? "—" : format(n);
function ManagementCard({label,value,hint,tone="neutral"}: {label:string;value:string;hint:string;tone?:string}) {
  return <article className={"vitrinaQCard vitrinaQTone-"+tone}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}
function ManagementOverview({scope,includePrivate,onTab}: {scope:ScopeRow[];includePrivate:boolean;onTab:(tab:ManagementTab)=>void}) {
  const q=buildVitrinaQuality(scope) as {rows:Array<ScopeRow & {issues:Array<{level:"confirmed"|"review"}>}>; organizations:number; organizationsWithIssues:number; confirmed:unknown[]; review:unknown[]};
  const now=scope.reduce((s,r)=>s+r.now,0), before=scope.reduce((s,r)=>s+r.before,0);
  const oldCount=scope.filter(r=>r.before>0).length;
  const i38=getVitrinaIncident38(includePrivate);
  const priority=[...q.rows].filter(r=>r.issues.length>0).sort((a,b)=>b.issues.filter(i=>i.level==="confirmed").length-a.issues.filter(i=>i.level==="confirmed").length || b.issues.length-a.issues.length).slice(0,5);
  return <div className="vitrinaQ vitrinaManagement">
    <div className="vitrinaMHeadline"><div><h2>Переход с ФЭР на Витрину 2.0</h2><p>Готовность перехода не оценена: наличие расписания не подтверждает доступность записи.</p></div><span className="vitrinaMStatus">Нет данных по слотам</span></div>
    <div className="vitrinaQCards">
      <ManagementCard label="МО с расписанием" value={format(q.organizations)} hint={"Предыдущий срез: "+format(oldCount)} />
      <ManagementCard label="Строки подразделений" value={format(now)} hint={format(before)+" → "+format(now)+" · "+(now-before>=0?"+":"")+format(now-before)}/>
      <ManagementCard label="МО с замечаниями" value={format(q.organizationsWithIssues)} hint={"Из "+format(q.organizations)+" МО с расписанием"} tone="amber"/>
      <ManagementCard label="И-38.9 · отдельно" value={pct(i38.total?.coverage)} hint={i38.dates.join(" / ")+" · "+i38.horizons.join(" / ")+" дней · план 60%, цель 70%"}/>
    </div>
    <div className="vitrinaQColumns">
      <section className="vitrinaQPanel"><div className="vitrinaQPanelTitle"><h2>Приоритет для проверки</h2><button className="vitrinaQOpen" onClick={()=>onTab("Контроль ошибок")}>Все замечания</button></div>
        <p className="vitrinaQMuted">Сначала МО с отсутствующими полями, затем по количеству замечаний. Не рейтинг доступности записи.</p>
        {priority.map(r=><div className="vitrinaMOrg" key={r.id}><span className="vitrinaQOrgCell"><OrganizationSignal issues={r.issues}/><span>{r.name}</span></span><strong>{r.issues.length}</strong></div>)}
        <p className="vitrinaQMuted">{format(q.confirmed.length)} отсутствующих полей · {format(q.review.length)} требуют сверки.</p>
      </section>
      <section className="vitrinaQPanel"><h2>Что известно о переходе</h2>
        <div className="vitrinaMStage"><b>Расписания</b><span className="vitrinaMPositive">Данные есть</span><button className="vitrinaQOpen" onClick={()=>onTab("Рейтинг МО")}>МО</button></div>
        <div className="vitrinaMStage"><b>Качество названий и адресов</b><span>Частичная проверка</span><button className="vitrinaQOpen" onClick={()=>onTab("Контроль ошибок")}>Проверить</button></div>
        <div className="vitrinaMStage"><b>Свободные слоты Витрины, врачи, кабинеты</b><span>Нет данных</span></div>
        <div className="vitrinaMStage"><b>Сопоставление с ФЭР / И-38</b><span>Нет единого среза</span><button className="vitrinaQOpen" onClick={()=>onTab("Сопоставление с И-38")}>Источники</button></div>
        <div className="vitrinaMStage"><b>Динамика расписаний</b><span>Два среза</span><button className="vitrinaQOpen" onClick={()=>onTab("Динамика")}>Динамика</button></div>
      </section>
    </div>
    <p className="vitrinaQNote">Источник Витрины: {snapshots.current.date}; дата предыдущей выгрузки отсутствует. И-38 — отдельный контур и период. Нулём пропуски не заменяются.</p>
  </div>;
}
function IncidentContext({scope,includePrivate,showSpecialties}: {scope:ScopeRow[];includePrivate:boolean;showSpecialties:boolean}) {
  const i=getVitrinaIncident38(includePrivate);
  return <div className="vitrinaQ vitrinaManagement">
    <div className="vitrinaQNote"><b>И-38.9, отдельный источник:</b> {i.dates.join(" / ")} · горизонт {i.horizons.join(" / ")} дней · {i.orgCount} МО. Не является выгрузкой слотов Витрины. Классификация МО соответствует разделу И-38; периметры двух источников могут различаться.</div>
    {showSpecialties ? <section className="vitrinaQPanel"><h2>Специальности: обеспеченность слотами ЕПГУ по И-38</h2><p className="vitrinaQMuted">От меньшей доли к большей. Слоты ЕПГУ / общий норматив. План 60%, цель 70%. Данные Витрины по специальностям не загружены.</p>
      <table className="vitrinaMTable"><thead><tr><th>Специальность</th><th>Норматив</th><th>Слоты ЕПГУ</th><th>Доля, %</th></tr></thead><tbody>{i.specialties.map(s=><tr key={s.code}><td>{s.name}</td><td>{val(s.aggregate?.norm)}</td><td>{val(s.aggregate?.epguSlots)}</td><td className={s.aggregate?.coverage==null?"":s.aggregate.coverage<60?"vitrinaMNegative":s.aggregate.coverage>=70?"vitrinaMPositive":""}>{pct(s.aggregate?.coverage)}</td></tr>)}</tbody></table>
    </section> : <div className="vitrinaQColumns">
      <section className="vitrinaQPanel"><h2>Витрина 2.0 · {snapshots.current.date}</h2><p>МО с расписаниями: <b>{scope.filter(r=>r.now>0).length}</b></p><p>Строки подразделений: <b>{format(scope.reduce((s,r)=>s+r.now,0))}</b></p><p>Слоты и посещения: <b>нет данных</b></p></section>
      <section className="vitrinaQPanel"><h2>И-38.9 · {i.dates.join(" / ")}</h2><p>МО в выгрузке: <b>{i.orgCount}</b></p><p>Слоты ЕПГУ: <b>{val(i.total?.epguSlots)}</b> / общий норматив <b>{val(i.total?.norm)}</b></p><p>Доля: <b>{pct(i.total?.coverage)}</b></p></section>
      <section className="vitrinaQPanel"><h2>Что нужно для сопоставления</h2><p>OID МО и подразделения, единая специальность ФНСИ, дата выгрузки, дата приёма, статус слота, одинаковый горизонт. До сверки периметров расхождение не рассчитывается.</p></section>
    </div>}
  </div>;
}

export default function VitrinaDashboard() {
  const [tab, setTab] = useState<ManagementTab>("Сводка МЗ");
  const [includePrivate, setIncludePrivate] = useState(false);
  const qualityScope = useMemo(
    () => all.filter((row) => !isTechnical(row.name) && (includePrivate || isState(row.name))),
    [includePrivate],
  );
  const tabs: ManagementTab[] = ["Сводка МЗ", "Рейтинг МО", "Специальности", "Контроль ошибок", "Сопоставление с И-38", "Динамика", "Инструкция МО", "Исключения"];
  return <section className="vitrinaQualityShell">
    <header className="vitrinaQHeader">
      <div><h1>Витрина 2.0 — Запись к врачу</h1><p>Управление переходом с ФЭР · расписания, доступность, качество данных</p></div>
      <div className="vitrinaQHeaderRight"><time>Витрина: {snapshots.current.date}</time><label><input type="checkbox" checked={includePrivate} onChange={(event) => setIncludePrivate(event.target.checked)}/> Все МО, включая частные</label></div>
    </header>
    <nav className="vitrinaQTabs vitrinaMTabs" role="tablist" aria-label="Разделы Витрины">
      {tabs.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
    </nav>
    {tab === "Сводка МЗ" ? <ManagementOverview scope={qualityScope} includePrivate={includePrivate} onTab={setTab}/>
      : tab === "Рейтинг МО" || tab === "Динамика" ? <><VitrinaPresence includePrivate={includePrivate} dynamics={tab==="Динамика"}/>{tab==="Динамика" && <VitrinaQualityDashboard organizations={qualityScope} view="Динамика" currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/>}</>
      : tab === "Специальности" || tab === "Сопоставление с И-38" ? <IncidentContext scope={qualityScope} includePrivate={includePrivate} showSpecialties={tab==="Специальности"}/>
      : <VitrinaQualityDashboard organizations={qualityScope} view={tab} currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/>}
  </section>;
}
