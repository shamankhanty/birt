"use client";

import { useMemo, useState } from "react";
import {
  buildVitrinaQuality,
  sortVitrinaQualityRows,
  VITRINA_QUALITY_CATEGORIES,
  VITRINA_SOURCE_COVERAGE
} from "../lib/vitrina-quality.js";
import "./vitrina-quality-dashboard.css";

export type VitrinaQualityTab = "Контроль ошибок" | "Динамика" | "Инструкция МО" | "Исключения";
export type VitrinaQualityOrganization = {
  id: string;
  name: string;
  before: number;
  now: number;
  rows: Array<{parent: string; name: string; address: string}>;
};

const specialties = [
  "врач-терапевт участковый", "врач общей практики (семейный врач)",
  "врач-хирург", "врач-офтальмолог", "врач-оториноларинголог",
  "врач-акушер-гинеколог", "врач-психиатр-нарколог", "врач-фтизиатр",
  "врач-стоматолог", "врач-стоматолог-терапевт", "врач-педиатр участковый",
  "врач-детский хирург", "врач-стоматолог детский",
  "врач-психиатр детский (подростковый)"
];
const num = (value: number) => new Intl.NumberFormat("ru-RU").format(value);

type QualityIssue = {
  id: string;
  orgId: string;
  orgName: string;
  unitName: string;
  category: string;
  level: "confirmed" | "review";
  field: string;
  original: string;
  instruction: string;
  reason: string;
  source: string;
};

type QualityRow = VitrinaQualityOrganization & { issues: QualityIssue[] };

/** Visible quality warning, not a declaration of federal rejection. */
export function OrganizationSignal({ issues }: { issues: Array<{level: "confirmed" | "review"}> }) {
  const confirmed = issues.filter((entry) => entry.level === "confirmed").length;
  const review = issues.filter((entry) => entry.level === "review").length;
  if (!confirmed && !review) return null;
  const message = [confirmed ? confirmed + " пустых полей" : null, review ? review + " требуют сверки" : null]
    .filter(Boolean).join("; ");
  return <span className={"vitrinaQSignal " + (confirmed ? "vitrinaQSignalConfirmed" : "vitrinaQSignalReview")}
    role="img" aria-label={"Сигнал качества: " + message} title={"Сигнал качества: " + message}>
    {confirmed ? "!" : "?"}
  </span>;
}

function Card({ label, value, hint, tone = "neutral" }: {label: string; value: string | number; hint: string; tone?: string}) {
  return <article className={"vitrinaQCard vitrinaQTone-" + tone}>
    <span>{label}</span><strong>{value}</strong><small>{hint}</small>
  </article>;
}

function IssueDetail({ issue }: { issue: QualityIssue }) {
  return <div className="vitrinaQIssueDetail">
    <div className="vitrinaQDetailHeading">
      <b>{issue.field}</b>
      <span className={issue.level === "confirmed" ? "vitrinaQPill vitrinaQPillDanger" : "vitrinaQPill vitrinaQPillWarning"}>
        {issue.level === "confirmed" ? "Поле отсутствует" : "Требует сверки"}
      </span>
    </div>
    <p>{issue.reason}</p>
    <div className="vitrinaQBeforeAfter">
      <div><small>В выгрузке сейчас</small><strong>{issue.original}</strong></div>
      <div><small>Рекомендуемое действие</small><strong>{issue.instruction}</strong></div>
    </div>
    <p className="vitrinaQMuted"><b>Подразделение:</b> {issue.unitName || "Без наименования"}</p>
    <p className="vitrinaQMuted"><b>Источник:</b> {issue.source}</p>
    <p className="vitrinaQMuted">Статус устранения: <b>Не определяется</b> — журнал подтверждённых исправлений не загружен.</p>
  </div>;
}

export default function VitrinaQualityDashboard({
  organizations, view, currentDate, previousDate
}: {
  organizations: VitrinaQualityOrganization[];
  view: VitrinaQualityTab;
  currentDate: string;
  previousDate: string | null;
}) {
  const summary = useMemo(() => buildVitrinaQuality(organizations) as {
    rows: QualityRow[]; issues: QualityIssue[]; confirmed: QualityIssue[];
    review: QualityIssue[]; organizations: number; organizationsWithIssues: number
  }, [organizations]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все категории");
  const [kind, setKind] = useState("Все замечания");
  const [sortBy, setSortBy] = useState("issues");
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);

  const filtered = useMemo(() => sortVitrinaQualityRows(summary.rows.filter((org) => {
    const text = (org.name + " " + org.rows.map((row) => row.name).join(" ")).toLocaleLowerCase("ru");
    const matches = org.issues.filter((issue) =>
      (category === "Все категории" || issue.category === category) &&
      (kind === "Все замечания" || (kind === "Подтверждённые" && issue.level === "confirmed") ||
        (kind === "Требуют сверки" && issue.level === "review")));
    return org.now > 0 && text.includes(query.trim().toLocaleLowerCase("ru")) &&
      (!onlyIssues || matches.length > 0) &&
      (category === "Все категории" && kind === "Все замечания" ? true : matches.length > 0);
  }).map((org) => ({
    ...org,
    issues: org.issues.filter((issue) =>
      (category === "Все категории" || issue.category === category) &&
      (kind === "Все замечания" || (kind === "Подтверждённые" && issue.level === "confirmed") ||
        (kind === "Требуют сверки" && issue.level === "review")))
  })), sortBy), [summary, query, category, kind, onlyIssues, sortBy]);

  const selected = filtered.find((org) => org.id === selectedOrg) || filtered[0] || null;
  const issue = selected?.issues.find((entry) => entry.id === selectedIssue) || selected?.issues[0] || null;
  const reviewRows = summary.rows.filter((org) => org.now > 0 && org.issues.some((entry) => entry.level === "review"));
  const categoryStats = ["Наименования", "Адреса"].map((name) => ({
    name, total: summary.issues.filter((entry) => entry.category === name).length,
    confirmed: summary.confirmed.filter((entry) => entry.category === name).length
  }));
  const max = Math.max(1, ...categoryStats.map((entry) => entry.total));

  if (view === "Инструкция МО") return <div className="vitrinaQ">
    <div className="vitrinaQCards vitrinaQCardsThree">
      <Card label="Проверки по инструкции" value="6" hint="Направления контроля" />
      <Card label="Базовых должностей" value={specialties.length} hint="Применяются по профилю МО" tone="amber" />
      <Card label="Редакция инструкции РТ" value="19.11.2026" hint="Инструкция для МО" tone="green" />
    </div>
    <div className="vitrinaQColumns">
      <div className="vitrinaQPanel">
        <h2>Памятка для медицинской организации</h2>
        <ol className="vitrinaQSteps">
          <li>Сверить полное название МО и подразделений с актуальными записями ФРМО.</li>
          <li>Проверить все адресные поля по ФРМО и ГАР, включая индекс и номер дома.</li>
          <li>Сверить данные врача с ФРМР и наименование должности со справочником ФНСИ без сокращений.</li>
          <li>Указать корректный номер кабинета и фактическое место приёма.</li>
          <li>Обеспечить реальные слоты для самостоятельной записи по применимым базовым должностям.</li>
          <li>Повторно проверить публикацию на ЕПГУ и последующую выгрузку Витрины.</li>
        </ol>
        <h3>14 базовых должностей для самостоятельной записи</h3>
        <div className="vitrinaQSpecialties">{specialties.map((name, index) =>
          <div key={name}><span>{index + 1}</span>{name}</div>)}</div>
        <p className="vitrinaQMuted">Перечень не означает, что каждая МО обязана иметь все 14 должностей. Учитываются профиль МО и возможность приёма без направления.</p>
      </div>
      <div className="vitrinaQPanel">
        <h2>Примеры корректировки</h2>
        <div className="vitrinaQExamples">
          <div><span>Нужно уточнить</span><b>Поликлиника</b><span>Сверить с ФРМО</span><b>Поликлиника № 3 (пример)</b></div>
          <div><span>Неполный адрес</span><b>, Татарстан Респ., г. Казань…</b><span>Проверить</span><b>Индекс, город, улица, дом по ФРМО / ГАР</b></div>
          <div><span>Произвольное сокращение</span><b>ЛОР</b><span>Наименование должности</span><b>врач-оториноларинголог</b></div>
        </div>
        <div className="vitrinaQInfo">Источник: «Инструкция для МО 19.11.2026.docx». Для конкретных ошибок требуется выгрузка ошибочных наименований и эталонные реестры.</div>
      </div>
    </div>
  </div>;

  if (view === "Динамика") return <div className="vitrinaQ">
    <div className="vitrinaQCards">
      <Card label="МО в текущем срезе" value={num(summary.organizations)} hint={"По состоянию на " + currentDate} />
      <Card label="Подтверждённо пустых полей" value={num(summary.confirmed.length)} hint="Название или адрес отсутствует" tone="red"/>
      <Card label="Признаков для сверки" value={num(summary.review.length)} hint="Не считать доказанной ошибкой" tone="amber"/>
      <Card label="Исправлено за период" value="—" hint="Не рассчитывается: нет журнала исправлений" tone="green"/>
    </div>
    <div className="vitrinaQColumns">
      <div className="vitrinaQPanel">
        <h2>Качество текущей выгрузки</h2>
        <p className="vitrinaQMuted">Распределение наблюдаемых замечаний по двум проверяемым категориям.</p>
        {categoryStats.map((item) => <div className="vitrinaQBarRow" key={item.name}>
          <div><b>{item.name}</b><span>{item.total} замечаний, из них {item.confirmed} с отсутствующими полями</span></div>
          <div className="vitrinaQBarTrack"><i style={{width: String(item.total / max * 100) + "%"}} /></div>
        </div>)}
        <p className="vitrinaQMuted">Специальности, кабинеты, слоты и соответствие реестрам не проверяются без дополнительных источников.</p>
      </div>
      <div className="vitrinaQPanel">
        <h2>Динамика устранения замечаний</h2>
        <div className="vitrinaQEmpty"><strong>Нет сопоставимой истории качества</strong>
          <p>У предыдущей выгрузки отсутствует дата ({previousDate || "дата не указана"}), а однозначных идентификаторов подразделений и реестра исправлений нет.</p>
          <p>Поэтому новые и исправленные ошибки, изменение критичности и динамику качества сейчас не вычисляем.</p>
        </div>
        <div className="vitrinaQInfo">Динамика количества подразделений по двум срезам доступна выше, в таблице динамики расписаний. Она не равна динамике качества данных.</div>
      </div>
    </div>
  </div>;

  if (view === "Исключения") return <div className="vitrinaQ">
    <div className="vitrinaQCards vitrinaQCardsThree">
      <Card label="МО, требующих сверки" value={reviewRows.length} hint="Не включать в подтверждённые ошибки" tone="amber"/>
      <Card label="Неактивные подразделения" value="—" hint="Нет статуса ФРМО в исходнике"/>
      <Card label="Несовпадения OID" value="—" hint="Нет OID для автоматической сверки"/>
    </div>
    <div className="vitrinaQColumns">
      <div className="vitrinaQPanel">
        <h2>Реестр спорных случаев</h2>
        <p className="vitrinaQMuted">Показаны только признаки неоднозначного наименования или адреса. Автоматическое исключение из оценки не производится.</p>
        <div className="vitrinaQExceptionList">
          {reviewRows.slice(0, 80).map((org) => <div key={org.id} className="vitrinaQExceptionRow">
            <b>{org.name}</b><span>{org.issues.filter((entry) => entry.level === "review").length} требуют сверки</span>
          </div>)}
          {!reviewRows.length && <p>По текущим правилам спорных записей нет.</p>}
        </div>
      </div>
      <div className="vitrinaQPanel">
        <h2>Правила работы с исключениями</h2>
        <p>Неактивные подразделения, переименования, изменения OID и расхождения с ФРМО нельзя автоматически считать нарушениями МО.</p>
        <p>В реестр подтверждённых исключений запись попадает только после ручной проверки причины и действующего статуса подразделения.</p>
        <div className="vitrinaQInfo"><b>Пока нет данных для проверки:</b> OID подразделений, актуальных статусов ФРМО, подтверждённых решений и даты закрытия исключений.</div>
      </div>
    </div>
  </div>;

  return <div className="vitrinaQ">
    <div className="vitrinaQCards">
      <Card label="МО с расписанием" value={num(summary.organizations)} hint={"Выгрузка от " + currentDate}/>
      <Card label="МО с замечаниями" value={num(summary.organizationsWithIssues)} hint="По доступным полям" tone="red"/>
      <Card label="Найдено замечаний" value={num(summary.issues.length)} hint={num(summary.confirmed.length) + " пустых полей; " + num(summary.review.length) + " требуют сверки"} tone="amber"/>
      <Card label="Подтверждённо исправлено" value="—" hint="Не рассчитывается без истории" tone="green"/>
    </div>
    <p className="vitrinaQNote"><b>Ограничение источника:</b> доступны только МО, подразделение и отображаемый адрес. Замечания о названии и индексе требуют сверки. Проверка ФРМО/ФРМР, врачей, специальностей, кабинетов и доступных слотов пока невозможна. Контрольная длительность приёма свыше 20 минут будет выделяться только после импорта проверенного источника слотов.</p>
    <div className="vitrinaQColumns">
      <div className="vitrinaQPanel">
        <div className="vitrinaQPanelTitle"><h2>Реестр замечаний по МО</h2><span>{filtered.length} МО</span></div>
        <div className="vitrinaQFilters">
          <input aria-label="Поиск по МО и подразделениям" placeholder="Поиск по МО или подразделению" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Категория замечания" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Все категории", ...VITRINA_QUALITY_CATEGORIES].map((name) => <option key={name}>{name}</option>)}
          </select>
          <select aria-label="Подтверждение замечания" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["Все замечания", "Подтверждённые", "Требуют сверки"].map((name) => <option key={name}>{name}</option>)}
          </select>
          <select aria-label="Сортировка МО" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="issues">Больше замечаний</option><option value="confirmed">Больше отсутствующих полей</option><option value="name">По названию</option>
          </select>
        </div>
        <label className="vitrinaQCheck"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Только МО с замечаниями</label>
        <div className="vitrinaQTableWrap"><table className="vitrinaQTable">
          <thead><tr><th>Медицинская организация</th><th>Замечаний</th><th>Пустых полей</th><th>Карточка</th></tr></thead>
          <tbody>{filtered.map((org) => <tr key={org.id} className={selected?.id === org.id ? "vitrinaQRowSelected" : ""}>
            <td><span className="vitrinaQOrgCell"><OrganizationSignal issues={org.issues}/><span>{org.name}</span></span></td>
            <td className="vitrinaQCount">{org.issues.length}</td>
            <td>{org.issues.filter((entry) => entry.level === "confirmed").length}</td>
            <td><button className="vitrinaQOpen" type="button" onClick={() => {setSelectedOrg(org.id);setSelectedIssue(null);}}>Открыть</button></td>
          </tr>)}</tbody></table>
          {!filtered.length && <div className="vitrinaQEmpty">По выбранным фильтрам записей нет. Нет данных для проверки по неподдерживаемым категориям.</div>}
        </div>
      </div>
      <div className="vitrinaQPanel">
        {selected ? <>
          <div className="vitrinaQPanelTitle"><h2>Карточка МО</h2><span className="vitrinaQPill">{selected.issues.length} замечаний</span></div>
          <h3 className="vitrinaQOrgTitle"><span className="vitrinaQOrgCell"><OrganizationSignal issues={selected.issues}/><span>{selected.name}</span></span></h3>
          {selected.issues.length > 0 ? <>
            <div className="vitrinaQChips">{selected.issues.map((entry, index) =>
              <button key={entry.id} onClick={() => setSelectedIssue(entry.id)} className={issue?.id === entry.id ? "active" : ""} type="button">
                {index + 1}. {entry.category}
              </button>)}</div>
            {issue && <IssueDetail issue={issue}/>}
          </> : <div className="vitrinaQEmpty">По доступным полям замечаний не найдено. Это не подтверждает корректность расписаний и слотов.</div>}
        </> : <div className="vitrinaQEmpty">Выберите медицинскую организацию для просмотра замечаний.</div>}
        <details open className="vitrinaQCoverage"><summary>Что проверяется по шести категориям</summary>
          {Object.entries(VITRINA_SOURCE_COVERAGE).map(([name, text]) => <p key={name}><b>{name}:</b> {text} — {text.startsWith("Нет") ? "Нет данных для проверки." : "Нужна сверка."}</p>)}
        </details>
      </div>
    </div>
    <p className="vitrinaQMuted">Источник: «МО с расписаниями на 23.11.xlsx», «МО_ у которых есть расписание (1).xlsx», инструкция для МО от 19.11.2026. Динамика исправлений не рассчитывается.</p>
  </div>;
}
