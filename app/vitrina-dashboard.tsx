"use client";

import { useMemo, useState } from "react";
import snapshots from "./vitrina-snapshots.json";
import "./vitrina-dashboard.css";

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
const format = (number: number) => new Intl.NumberFormat("ru-RU").format(number);
const specialties = ["врач-терапевт участковый", "врач общей практики (семейный врач)", "врач-хирург", "врач-офтальмолог", "врач-оториноларинголог", "врач-акушер-гинеколог", "врач-психиатр-нарколог", "врач-фтизиатр", "врач-стоматолог", "врач-стоматолог-терапевт", "врач-педиатр участковый", "врач-детский хирург", "врач-стоматолог детский", "врач-психиатр детский (подростковый)"];

export default function VitrinaDashboard() {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"delta" | "now" | "name">("delta");
  const [selected, setSelected] = useState<string | null>(null);
  const scope = useMemo(() => all.filter((row) => includePrivate || isState(row.name)), [includePrivate]);
  const filtered = useMemo(() => scope.filter((row) => key(row.name).includes(key(query))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : sort === "now" ? b.now - a.now : a.delta - b.delta || b.now - a.now), [scope, query, sort]);
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
    <div className="vitrinaToolbar"><h2>Динамика по МО</h2><input aria-label="Поиск МО" placeholder="Найти МО" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Сортировка" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="delta">Сначала снижение</option><option value="now">По числу подразделений</option><option value="name">По названию</option></select></div>
    <div className="vitrinaTableWrap"><table><thead><tr><th>МО</th><th>Было</th><th>Стало</th><th>Изменение</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} onClick={() => setSelected(row.id)} className={selected === row.id ? "selected" : ""}><td>{row.name}</td><td>{row.before}</td><td>{row.now}</td><td className={row.delta > 0 ? "positive" : row.delta < 0 ? "negative" : ""}>{row.delta > 0 ? "+" : ""}{row.delta}</td></tr>)}</tbody></table></div>
    {chosen && <section className="vitrinaDetail"><div><h2>{chosen.name}</h2><button onClick={() => setSelected(null)}>Закрыть</button></div><p>Подразделений: {chosen.before} → {chosen.now}. Состав нового среза:</p><ul>{chosen.rows.map((row, index) => <li key={`${row.name}-${row.address}-${index}`}><strong>{row.name}</strong><span>{row.address || "Адрес не указан"}</span></li>)}</ul></section>}
    <small className="vitrinaSource">Источник: «МО_ у которых есть расписание (1).xlsx» и «МО с расписаниями на 23.11.xlsx». Единица учёта — строка подразделения.</small>
  </section>;
}
