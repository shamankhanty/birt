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
  const [roleSearch, setRoleSearch] = useState("");
  const [drillRole, setDrillRole] = useState<string | null>(null);
  const [drillOid, setDrillOid] = useState<string | null>(null);
  const [drillIssue, setDrillIssue] = useState<"all" | "mo" | "department">("all");
  const [last4Query, setLast4Query] = useState("");
  const [recordsShown, setRecordsShown] = useState(50);
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
  const staffRows = data.rows.filter(row => row.category !== "frmo");
  const roleCounts = [...staffRows.reduce((map, row) => {
    map.set(row.role, (map.get(row.role) ?? 0) + row.count);
    return map;
  }, new Map<string, number>()).entries()].filter(([role]) =>
    role.toLocaleLowerCase("ru").includes(roleSearch.trim().toLocaleLowerCase("ru")))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  const roleRows = staffRows.filter(row => row.role === drillRole);
  const departmentGroups = [...roleRows.reduce((map, row) => {
    const existing = map.get(row.oid) ?? { oid: row.oid, name: row.frmrDepartment, mo: 0, department: 0 };
    existing[row.category as "mo" | "department"] += row.count;
    map.set(row.oid, existing);
    return map;
  }, new Map<string, {oid: string; name: string; mo: number; department: number}>()).values()]
    .sort((a, b) => (b.mo + b.department) - (a.mo + a.department) || a.name.localeCompare(b.name, "ru"));
  const chosenRows = roleRows.filter(row => row.oid === drillOid && (drillIssue === "all" || row.category === drillIssue));
  const employeeRecords = chosenRows.flatMap(row => (row.staffRecords ?? []).map(rec => ({
    record: rec, category: row.category, issue: row.reason,
  }))).sort((a, b) => a.record[5] - b.record[5]);
  const trimmedLast4 = last4Query.replace(/\D/g, "").slice(0, 4);
  const filteredEmployees = employeeRecords.filter(({record}) => !trimmedLast4 || record[3]?.includes(trimmedLast4));


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
    <div className={styles.content}>
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
            <thead><tr><th>Тип / проблема</th><th>Должность</th><th>Подразделение ФРМР / ГИС</th><th>Количество</th><th>Статус</th></tr></thead>
            <tbody>{visible.slice(0, shown).map(row => <tr key={row.key} className={activeKey === row.key ? styles.selected : ""}>
              <td><button className={styles.rowButton} type="button" onClick={() => {
                  setActiveKey(activeKey === row.key ? null : row.key);
                  if (row.staffRecords) {
                    setDrillRole(row.role); setDrillOid(row.oid);
                    setDrillIssue(row.category as "mo" | "department");
                    setLast4Query(""); setRecordsShown(50);
                  }
                }}>
                <b>{row.category === "mo" ? "На уровне МО" : row.category === "department" ? "Привязка СП" : "СП ↔ ФРМО"}</b><span>{row.reason}</span></button></td>
              <td>{row.role}</td><td><b>{row.frmrDepartment}</b><small>{row.gisDepartment}</small><code>{row.oid}</code></td>
              <td>{format(row.count)}</td>
              <td><span className={row.flagged ? styles.flagged : styles.clean}>{row.flagged ? "Проверить" : "Без признаков"}</span></td>
            </tr>)}</tbody>
          </table></div>
          {visible.length === 0 && <p className={styles.empty}>По выбранным условиям записей нет. Проверьте фильтры и наличие сопоставления МО.</p>}
          <div className={styles.tableBottom}><small>Показано {Math.min(shown,visible.length)} из {visible.length} групп/строк. Нажмите на проблему для детализации.</small>
          {shown < visible.length && <button type="button" onClick={() => setShown(n => n + 60)}>Показать ещё 60</button>}</div>
          {active && <div className={styles.details} aria-live="polite">
            <h3>{active.reason}</h3><p><b>{active.role}</b> · {active.frmrDepartment} · {active.source} ({active.cut})</p>
            <p>OID для сверки: <code>{active.oid}</code></p>
            {active.staffRecords && <p>Должностных записей: <b>{format(active.staffRecords.length)}</b>. Ниже открыт маршрут «Должность → СП → сотрудники» со всеми доступными записями и поиском по СНИЛС.</p>}
            {active.auditRecord && <><p>Филиал ГИС: {active.auditRecord.branchGis || "не указан"}. Филиал ФРМО: {active.auditRecord.branchFrmo || "не указан"}.</p>
              <p>OID ФРМО: <code>{active.auditRecord.oidFrmo || "не указан"}</code>. Привязка СП: {active.auditRecord.departmentBranch || "не указана"}.</p>
              <p>Наличие даты исключения и изменение названия требуют проверки актуального состояния ФРМО; автоматически ошибкой МО не считаются.</p></>}
          </div>}
        </section>
        <section className={styles.drillCard} data-testid="frmr-person-drilldown">
          <div className={styles.drillHead}>
            <h3>Должность → СП → конкретные записи</h3>
            <p>Выберите должность, затем подразделение. Отображаются должностные записи ФРМР по выбранной МО, без раскрытия полного СНИЛС. Срез {staffSource.summary.sourceCut}.</p>
          </div>
          <div className={styles.drillGrid}>
            <div className={styles.drillColumn}>
              <h4>1. Должность ФРМР</h4>
              <input type="search" className={styles.drillInput} value={roleSearch}
                onChange={e => setRoleSearch(e.target.value)}
                placeholder="Поиск должности" aria-label="Поиск должностей ФРМР"/>
              <div className={styles.drillOptions}>
                {roleCounts.map(([role, count]) => <button type="button" key={role}
                  aria-pressed={drillRole === role} className={drillRole === role ? styles.drillSelected : ""}
                  onClick={() => {setDrillRole(role);setDrillOid(null);setDrillIssue("all");setLast4Query("");setRecordsShown(50);}}>
                  <span>{role}</span><b>{format(count)}</b>
                </button>)}
                {!roleCounts.length && <p className={styles.drillHint}>Должностей по запросу нет.</p>}
              </div>
            </div>
            <div className={styles.drillColumn}>
              <h4>2. Структурное подразделение</h4>
              {drillRole ? <><p className={styles.drillHint}>Выберите СП по должности «{drillRole}».</p>
                <div className={styles.drillOptions}>
                  {departmentGroups.map(dep => <button type="button" key={dep.oid}
                    aria-pressed={drillOid === dep.oid} className={drillOid === dep.oid ? styles.drillSelected : ""}
                    onClick={() => {setDrillOid(dep.oid);setDrillIssue("all");setLast4Query("");setRecordsShown(50);}}>
                    <span><strong>{dep.name}</strong><small>OID: {dep.oid}</small>
                      <small>На уровне МО: {format(dep.mo)} · СП: {format(dep.department)}</small></span>
                    <b>{format(dep.mo + dep.department)}</b>
                  </button>)}
                </div></> : <p className={styles.drillHint}>Сначала выберите должность слева.</p>}
            </div>
            <div className={styles.drillColumn}>
              <h4>3. Записи сотрудников</h4>
              {drillOid ? <>
                <p className={styles.drillHint}><b>{drillRole}</b> · {departmentGroups.find(d => d.oid === drillOid)?.name} · OID СП: {drillOid}</p>
                <div className={styles.drillFilters} role="group" aria-label="Тип расхождения по сотрудникам">
                  {([["all","Все"],["mo","Нет должности в МО"],["department","Не совпадает СП"]] as const).map(([key,label]) =>
                    <button type="button" key={key} aria-pressed={drillIssue === key}
                      className={drillIssue === key ? styles.drillSelected : ""}
                      onClick={() => {setDrillIssue(key);setRecordsShown(50);}}>{label}</button>)}
                </div>
                <input className={styles.drillInput} type="search" inputMode="numeric"
                  maxLength={4} value={last4Query}
                  onChange={e => {setLast4Query(e.target.value.replace(/\D/g,"").slice(0,4));setRecordsShown(50);}}
                  placeholder="Последние 4 цифры СНИЛС" aria-label="Поиск по последним четырём цифрам СНИЛС"/>
                <p className={styles.drillHint}>Найдено {format(filteredEmployees.length)} записей. Номер строки — для поиска в первичной ведомости.</p>
                <div className={styles.employeeScroll}>
                  <table className={styles.employeeTable}>
                    <thead><tr><th>Строка</th><th>СНИЛС</th><th>Причина</th></tr></thead>
                    <tbody>{filteredEmployees.slice(0,recordsShown).map(({record,category},i) =>
                      <tr key={record[5]+"-"+i}><td>№ {record[5]}</td>
                        <td className={styles.maskedSnils}>{record[3]===null ? "Нет данных" : "•••-•••-•"+record[3]}</td>
                        <td>{category === "mo" ? "Нет должности в МО" : "Не совпадает СП"}</td>
                      </tr>)}</tbody>
                  </table>
                </div>
                {!filteredEmployees.length && <p className={styles.drillHint}>Для выбранных условий записей нет.</p>}
                {recordsShown < filteredEmployees.length &&
                  <button type="button" className={styles.drillMore} onClick={() => setRecordsShown(n => n + 50)}>Показать ещё 50</button>}
              </> : <p className={styles.drillHint}>Выберите СП во второй колонке либо нажмите на проблему ФРМР в таблице выше — должность и подразделение будут выбраны автоматически.</p>}
            </div>
          </div>
        </section>
        <details className={styles.accordion}><summary>История и источники</summary>
          <p>ФРМР ↔ ГИС: {staffSource.summary.sourceCut}. СП ↔ ФРМО: {auditRaw.sourceCut}.</p>
          {data.auditOrg && <p>Строк в своде СП: {format(data.auditOrg.current)} на {auditRaw.sourceCut}; {format(data.auditOrg.previous)} на {auditRaw.previousCut}; {format(data.auditOrg.old)} на {auditRaw.historicCut}. Это состав строк, а не динамика подтверждённых ошибок.</p>}
          <p>Из подсчётов ФРМР исключены согласованные категории персонала; история не переписывается, снижение числа строк само по себе не доказывает исправление.</p>
        </details>
      </div>
    </div>
  </div>;
}
