"use client";

import { useMemo, useState } from "react";
import snapshots from "./vitrina-snapshots.json";
import { sortVitrinaRows, type VitrinaSortColumn, type VitrinaSortDirection } from "../lib/vitrina-sort.js";
import "./vitrina-dashboard.css";
import VitrinaQualityDashboard, { OrganizationSignal, type VitrinaQualityTab } from "./vitrina-quality-dashboard";
import { findVitrinaQualityIssues } from "../lib/vitrina-quality.js";


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

function VitrinaPresence() {
  const [includePrivate, setIncludePrivate] = useState(false);
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
    <div className="vitrinaHead"><div><h1>Витрина</h1><p>МО и подразделения с расписанием · срез на {snapshots.current.date}</p></div><label><input type="checkbox" checked={includePrivate} onChange={(event) => setIncludePrivate(event.target.checked)} /> Показать все организации</label></div>
    <div className="vitrinaCards">
      <article><span>МО с расписанием</span><strong>{format(scope.filter((r) => r.now > 0).length)}</strong><small>предыдущий срез: {format(scope.filter((r) => r.before > 0).length)}</small></article>
      <article><span>Подразделения</span><strong>{format(now)}</strong><small>{format(before)} → {format(now)} · {now - before >= 0 ? "+" : ""}{format(now - before)}</small></article>
      <article><span>МО с приростом</span><strong className="positive">{growing}</strong><small>по числу подразделений</small></article>
      <article><span>МО со снижением</span><strong className="negative">{falling}</strong><small>требуют сверки состава</small></article>
    </div>
    <p className="vitrinaNotice">Показано наличие расписаний в выгрузке, а не число свободных слотов. Дата предыдущего среза в файле отсутствует; изменение названий МО и подразделений требует проверки.</p>
    <details className="vitrinaGuide"><summary>Что сделать МО · инструкция по корректировке данных на ЕПГУ</summary><ol><li>Сверить наименование МО с ФРМО и исправить расхождения в расписании Витрины.</li><li>Сверить адрес с ФРМО и заполнить все поля адреса.</li><li>Привести расписание врачей в соответствие с инструкциями разработчика ГИС ЭЗ РТ. Открыть слоты для записи граждан по применимым базовым специальностям; названия специальностей указывать полностью, как в ФРМО, без сокращений.</li></ol><details><summary>Перечень 14 базовых специальностей</summary><ul>{specialties.map((name) => <li key={name}>{name}</li>)}</ul></details><p>Другие специальности допустимы при подтверждении, что помощь без направления предусмотрена территориальной программой государственных гарантий или бюджетом региона. Конкретные замечания МО следует брать из приложенного к инструкции перечня ошибочных наименований; в этих двух выгрузках перечня нет.</p><small>Источник: «Инструкция для МО 19.11.2026.docx». Наличие строки расписания само по себе не подтверждает исполнение этих требований.</small></details>
    <div className="vitrinaToolbar"><h2>Динамика по МО</h2><input aria-label="Поиск МО" placeholder="Найти МО" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="vitrinaSortHint">Сортировка — нажатием на заголовок столбца</span></div>
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


/**
 * Quality is an additional workspace. Keep original presence/delta table untouched:
 * availability rows are not evidence of available booking slots or quality fixes.
 */
export default function VitrinaDashboard() {
  const [tab, setTab] = useState<VitrinaQualityTab | "Наличие расписаний">("Контроль ошибок");
  const [includePrivate, setIncludePrivate] = useState(false);
  const qualityScope = useMemo(
    () => all.filter((row) => !isTechnical(row.name) && (includePrivate || isState(row.name))),
    [includePrivate],
  );
  const tabs = ["Контроль ошибок", "Динамика", "Инструкция МО", "Исключения", "Наличие расписаний"] as const;

  return <section className="vitrinaQualityShell">
    <header className="vitrinaQHeader">
      <div>
        <h1>Витрина 2.0 — Запись к врачу</h1>
        <p>Наличие расписаний и качество данных медицинских организаций Республики Татарстан</p>
      </div>
      <div className="vitrinaQHeaderRight">
        <time>Данные на {snapshots.current.date}</time>
        {tab !== "Наличие расписаний" && <label>
          <input type="checkbox" checked={includePrivate} onChange={(event) => setIncludePrivate(event.target.checked)}/>
          Все МО, включая частные
        </label>}
      </div>
    </header>
    <nav className="vitrinaQTabs" role="tablist" aria-label="Разделы Витрины">
      {tabs.map((name) => <button key={name} type="button" role="tab"
        aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
    </nav>
    {tab === "Наличие расписаний"
      ? <VitrinaPresence />
      : <VitrinaQualityDashboard organizations={qualityScope} view={tab}
          currentDate={snapshots.current.date} previousDate={snapshots.previous.date}/>}
  </section>;
}
