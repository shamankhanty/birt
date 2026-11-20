"use client";

import { useMemo, useState } from "react";
import allRaw from "./frmr-all-specialties.json";
import spTypes from "./frmr-sp-types.json";
import linkage from "./frmo-linkage-data.json";
import auditRaw from "./frmr-sp-audit-20261119.json";
import { applyFrmrScope } from "../lib/frmr-scope";
import styles from "./frmr-mo-workspace.module.css";

const prefix = "1.2.643.5.1.13.13.12.2.16.";
const format = (n: number | null | undefined) => typeof n === "number" ? n.toLocaleString("ru-RU") : "—";
const normalize = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е")
  .replace(/центральная районная больница/g, "црб")
  .replace(/\b(гауз|гбуз|республики татарстан|республика татарстан)\b/g, "")
  .replace(/[^а-яa-z0-9]/g, "");

const staffSource = applyFrmrScope(allRaw, spTypes.types).data as {
  summary: { sourceCut: string; rows: [string, string, number | null, number | null, number, number, number, number | null, [string, number][]][] };
  departments: { mos: string[]; roles: string[]; sp: [number, string, string][]; rows: [number, number, number, number, number][] };
  records: { rows: StaffRecord[] };
};
type StaffRecord = [number, number, number, string | null, number, number, number?];
type AuditRecord = (typeof auditRaw.records)[number];
type Category = "mo" | "department" | "frmo";
type Row = {
  key: string; category: Category; reason: string; role: string; frmrDepartment: string;
  gisDepartment: string; oid: string; count: number; source: string; cut: string;
  flagged: boolean; staffRecords?: StaffRecord[]; auditRecord?: AuditRecord;
};
const auditFlags: Record<string, string> = {
  oid: "Различается OID филиала",
  missing: "OID отсутствует с одной стороны",
  inactive: "Активное отделение в неактивном филиале",
  excluded: "Указана дата исключения СП",
  name: "Различается название филиала",
};

function resolveAuditOrganization(suffix: string, name: string) {
  const exact = auditRaw.summary.filter(mo => normalize(mo.name) === normalize(name));
  if (exact.length === 1) return exact[0];
  const oid = prefix + suffix;
  const candidates = [...new Set(linkage.organizations
    .filter(org => org.parentOids.includes(oid))
    .map(org => org.code))];
  const linked = auditRaw.summary.filter(mo => candidates.includes(mo.id));
  // A single OID may belong to both a historical branch and a current MO.
  // Never merge ambiguous organizations on OID alone.
  return linked.length === 1 ? linked[0] : null;
}

export default function FrmrMoWorkspace({ selectedId, selectedName }: { selectedId: string; selectedName: string }) {
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [shown, setShown] = useState(60);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const data = useMemo(() => {
    const org = staffSource.summary.rows.find(row => row[0] === selectedId);
    const auditOrg = resolveAuditOrganization(selectedId, selectedName);
    const auditRows = auditOrg ? auditRaw.records.filter(row => row.mo === auditOrg.id) : null;
    const moIndex = staffSource.departments.mos.indexOf(selectedId);
    const records = staffSource.records.rows;
    const grouped = new Map<string, StaffRecord[]>();
    if (moIndex >= 0) {
      records.forEach(rec => {
        if (rec[0] !== moIndex) return;
        const key = rec[1] + ":" + rec[2] + ":" + rec[4];
        const list = grouped.get(key) ?? [];
        list.push(rec);
        grouped.set(key, list);
      });
    }
    const result: Row[] = [];
    for (const [m, role, sp, noPosition, wrongDepartment] of staffSource.departments.rows) {
      if (m !== moIndex) continue;
      const [spMo, spSuffix, spName] = staffSource.departments.sp[sp];
      if (spMo !== m) throw new Error("Не совпадает OID МО в детализации ФРМР");
      const oid = spSuffix ? prefix + selectedId + ".0." + spSuffix : "Не указан";
      for (const item of [{ category: "mo" as const, issue: 0, count: noPosition, reason: "Нет должности на уровне МО" },
                          { category: "department" as const, issue: 1, count: wrongDepartment, reason: "Не совпадает привязка СП" }]) {
        if (!item.count) continue;
        const matched = grouped.get(role + ":" + sp + ":" + item.issue) ?? [];
        result.push({
          key: item.category + ":" + role + ":" + sp, category: item.category, reason: item.reason,
          role: staffSource.departments.roles[role], frmrDepartment: spName,
          gisDepartment: "Сверить с ГИС", oid, count: item.count,
          source: "ФРМР ↔ ГИС", cut: staffSource.summary.sourceCut, flagged: true, staffRecords: matched,
        });
      }
    }
    if (auditRows) for (let i = 0; i < auditRows.length; i++) {
      const row = auditRows[i];
      result.push({
        key: "frmo:" + i, category: "frmo",
        reason: row.flags.length ? row.flags.map(flag => auditFlags[flag] ?? flag).join("; ") : "Признаков расхождения нет",
        role: "—", frmrDepartment: row.department || "Отделение не указано",
        gisDepartment: row.branchGis || "Филиал ГИС не указан",
        oid: row.departmentOid || row.oidFrmo || "Не указан", count: 1,
        source: "СП ↔ ФРМО", cut: auditRaw.sourceCut,
        flagged: row.flags.length > 0, auditRecord: row,
      });
    }
    const categoryOrder: Record<Category, number> = { mo: 0, department: 1, frmo: 2 };
    result.sort((a, b) => Number(b.flagged) - Number(a.flagged) ||
      categoryOrder[a.category] - categoryOrder[b.category] ||
      b.count - a.count || a.role.localeCompare(b.role, "ru"));
    return {
      org, auditOrg, auditRows, rows: result,
      stageMo: org ? org[5] : null, stageSp: org ? org[6] : null, total: org ? org[4] : null,
      flaggedFrmo: auditRows ? auditRows.filter(row => row.flags.length > 0).length : null,
      allFrmo: auditRows?.length ?? null,
    };
  }, [selectedId, selectedName]);

  const visible = data.rows.filter(row => (filter === "all" || row.category === filter) &&
    (!onlyIssues || row.flagged) &&
    (!query || (row.reason + " " + row.role + " " + row.frmrDepartment + " " + row.gisDepartment + " " + row.oid)
      .toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))));
  const active = data.rows.find(row => row.key === activeKey) ?? null;
  const groupedDepartments = data.rows.filter(row => row.flagged)
    .reduce((map, row) => {
      const key = (row.category === "frmo" ? "ФРМО · " : "ФРМР · ") + row.frmrDepartment + " · " + row.oid;
      map.set(key, (map.get(key) ?? 0) + row.count);
      return map;
    }, new Map<string, number>());

  function saveCsv() {
    const header = ["Тип", "Проблема", "Должность", "Подразделение ФРМР", "Подразделение ГИС/ФРМО", "OID", "Количество", "Источник", "Дата"];
    const cells = [header, ...visible.map(row => [row.category, row.reason, row.role, row.frmrDepartment,
      row.gisDepartment, row.oid, String(row.count), row.source, row.cut])];
    const csv = "\ufeff" + cells.map(line => line.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "frmr-mo-" + selectedId + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.workspace} data-testid="frmr-unified-mo-workspace">
    <div className={styles.heading}><div>
      <h2>Все расхождения выбранной МО</h2>
      <p>Единая рабочая карточка: должности, привязки СП, сопоставление с ФРМО. ФРМР — должностные записи; ФРМО — строки подразделений. Их итоги не суммируются.</p>
    </div><div className={styles.actions}>
      <button type="button" onClick={() => setOnlyIssues(value => !value)} aria-pressed={onlyIssues}>{onlyIssues ? "✓ Только с расхождениями" : "Все строки"}</button>
      <button type="button" onClick={saveCsv}>Экспорт CSV</button>
    </div></div>

    <div className={styles.stats}>
      <article><span>Всего расхождений ФРМР</span><strong>{format(data.total)}</strong><small>Должностных записей, без двойного учёта · {staffSource.summary.sourceCut}</small></article>
      <article><span>На уровне МО</span><strong>{format(data.stageMo)}</strong><small>Нет соответствующей должности в ГИС</small></article>
      <article><span>Привязки СП</span><strong>{format(data.stageSp)}</strong><small>Должность есть, не совпало подразделение</small></article>
      <article><span>СП ↔ ФРМО</span><strong>{format(data.flaggedFrmo)}</strong><small>Строк с диагностическими признаками · {auditRaw.sourceCut}</small></article>
    </div>
    {!data.auditOrg && <p className={styles.warning} role="status">В источнике привязок СП не удалось однозначно сопоставить эту МО. Значение ФРМО не рассчитано и не заменено нулём. Проверьте OID и код МО в справочнике.</p>}
    <div className={styles.layout}>
      <div className={styles.left}>
        <section className={styles.tableCard}>
          <nav className={styles.tabs} aria-label="Типы расхождений">
            {([["all", "Все проблемы"], ["mo", "Должности / МО"], ["department", "Привязки СП"], ["frmo", "СП ↔ ФРМО"]] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? styles.active : ""}
                onClick={() => { setFilter(value); setShown(60); setActiveKey(null); }}>{label}</button>)}
          </nav>
          <div className={styles.tableTop}>
            <p>Показаны группы проблем ФРМР и отдельные строки СП–ФРМО; статус «проверить» ещё не означает вину МО.</p>
            <input type="search" value={query} onChange={event => {setQuery(event.target.value);setShown(60)}} placeholder="Найти должность, СП или OID" aria-label="Поиск расхождений МО"/>
          </div>
          <div className={styles.scroll}><table className={styles.table}>
            <thead><tr><th>Тип / проблема</th><th>Должность</th><th>Подразделение ФРМР / ГИС</th><th>Количество</th><th>Источник / дата</th><th>Статус</th></tr></thead>
            <tbody>{visible.slice(0, shown).map(row => <tr key={row.key} className={activeKey === row.key ? styles.selected : ""}>
              <td><button className={styles.rowButton} type="button" onClick={() => setActiveKey(activeKey === row.key ? null : row.key)}>
                <b>{row.category === "mo" ? "На уровне МО" : row.category === "department" ? "Привязка СП" : "СП ↔ ФРМО"}</b><span>{row.reason}</span></button></td>
              <td>{row.role}</td><td><b>{row.frmrDepartment}</b><small>{row.gisDepartment}</small><code>{row.oid}</code></td>
              <td>{format(row.count)}</td><td><b>{row.source}</b><small>{row.cut}</small></td>
              <td><span className={row.flagged ? styles.flagged : styles.clean}>{row.flagged ? "Проверить" : "Без признаков"}</span></td>
            </tr>)}</tbody>
          </table></div>
          {visible.length === 0 && <p className={styles.empty}>По выбранным условиям записей нет. Проверьте фильтры и наличие сопоставления МО.</p>}
          <div className={styles.tableBottom}><small>Показано {Math.min(shown,visible.length)} из {visible.length} групп/строк. Нажмите на проблему для детализации.</small>
          {shown < visible.length && <button type="button" onClick={() => setShown(n => n + 60)}>Показать ещё 60</button>}</div>
          {active && <div className={styles.details} aria-live="polite">
            <h3>{active.reason}</h3><p><b>{active.role}</b> · {active.frmrDepartment} · {active.source} ({active.cut})</p>
            <p>OID для сверки: <code>{active.oid}</code></p>
            {active.staffRecords && <><p>Должностных записей: {format(active.staffRecords.length)}. Номер строки помогает найти запись в исходном файле. Полные СНИЛС и ФИО не публикуются.</p>
              <div className={styles.recordList}>{active.staffRecords.slice(0, 100).map((rec, i) =>
                <span key={rec[5] + "-" + i}>Строка {rec[5]} · СНИЛС {rec[3] ? "•••-•••-•" + rec[3] : "не указан"}</span>)}</div>
              {active.staffRecords.length > 100 && <p>Показаны первые 100 записей; остальные доступны в исходном файле.</p>}</>}
            {active.auditRecord && <><p>Филиал ГИС: {active.auditRecord.branchGis || "не указан"}. Филиал ФРМО: {active.auditRecord.branchFrmo || "не указан"}.</p>
              <p>OID ФРМО: <code>{active.auditRecord.oidFrmo || "не указан"}</code>. Привязка СП: {active.auditRecord.departmentBranch || "не указана"}.</p>
              <p>Наличие даты исключения и изменение названия требуют проверки актуального состояния ФРМО; автоматически ошибкой МО не считаются.</p></>}
          </div>}
        </section>
        <details className={styles.accordion}><summary>Детализация записей по сотрудникам</summary>
          <p>Выберите строку с расхождением ФРМР в таблице выше: откроются последние четыре цифры СНИЛС, номер строки и точное подразделение. Полные персональные данные на сайте не хранятся.</p>
        </details>
        <details className={styles.accordion}><summary>Подразделения с расхождениями ({groupedDepartments.size})</summary>
          {[...groupedDepartments.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 80).map(([name,count]) => <p key={name}>{name} — {format(count)} {data.rows.some(row => row.category === "frmo") ? "записей/строк (разные единицы учёта)" : "записей"}</p>)}
          {groupedDepartments.size > 80 && <p>Показаны первые 80 подразделений. Все строки доступны в таблице и экспорте.</p>}
        </details>
        <details className={styles.accordion}><summary>История и источники</summary>
          <p>ФРМР ↔ ГИС: {staffSource.summary.sourceCut}. СП ↔ ФРМО: {auditRaw.sourceCut}.</p>
          {data.auditOrg && <p>Строк в своде СП: {format(data.auditOrg.current)} на {auditRaw.sourceCut}; {format(data.auditOrg.previous)} на {auditRaw.previousCut}; {format(data.auditOrg.old)} на {auditRaw.historicCut}. Это состав строк, а не динамика подтверждённых ошибок.</p>}
          <p>Из подсчётов ФРМР исключены согласованные категории персонала; история не переписывается, снижение числа строк само по себе не доказывает исправление.</p>
        </details>
      </div>
      <aside className={styles.sidebar}>
        <section><h3>Что исправлять сначала</h3>
          <ol><li><b>Должности на уровне МО.</b> Сверить кадровую запись, OID МО и должность в ГИС.</li>
          <li><b>Привязка сотрудника к СП.</b> Проверить OID фактического подразделения; не менять автоматически.</li>
          <li><b>ФРМО.</b> Проверить филиал, отделение, OID, статус и дату исключения.</li></ol>
        </section>
        <section><h3>Сводка по типам проблем</h3>
          {[["Нет должности в МО", data.stageMo], ["Не совпадает СП", data.stageSp], ["Признаки СП–ФРМО", data.flaggedFrmo]].map(([label,n]) =>
            <div className={styles.miniBar} key={label as string}><span>{label}</span><b>{format(n as number | null)}</b><div><i style={{width:typeof n==="number" ? (100*n/Math.max(1,data.stageMo ?? 0,data.stageSp ?? 0,data.flaggedFrmo ?? 0))+"%" : "0%"}} /></div></div>)}
          <p>Последний показатель учитывает строки СП, первые два — должностные записи. Суммировать нельзя.</p>
        </section>
        <section><h3>Как проверить</h3>
          <p>Проверяйте первичный источник и действующие записи. Несовпадение названия или отсутствие OID — основание для сверки, не доказательство ошибки МО.</p>
          <p>После исправления дождитесь следующей выгрузки и сравните ту же запись по идентификаторам.</p>
        </section>
      </aside>
    </div>
  </div>;
}
