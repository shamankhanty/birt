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
  const [workspaceTab, setWorkspaceTab] = useState<"staff" | "frmo">("staff");
  const [roleSearch, setRoleSearch] = useState("");
  const [drillRole, setDrillRole] = useState<string | null>(null);
  const [drillOid, setDrillOid] = useState<string | null>(null);
  const [drillIssue, setDrillIssue] = useState<"all" | "mo" | "department">("all");
  const [last4Query, setLast4Query] = useState("");
  const [recordsShown, setRecordsShown] = useState(50);
  const [auditSearch, setAuditSearch] = useState("");
  const [onlyAuditIssues, setOnlyAuditIssues] = useState(true);
  const [selectedAuditKey, setSelectedAuditKey] = useState<string | null>(null);

  const data = useMemo(() => {
    const org = staffSource.summary.rows.find(row => row[0] === selectedId);
    const auditOrg = resolveAuditOrganization(selectedId, selectedName);
    const auditRows = auditOrg ? auditRaw.records.filter(row => row.mo === auditOrg.id) : null;
    const moIndex = staffSource.departments.mos.indexOf(selectedId);
    const grouped = new Map<string, StaffRecord[]>();
    if (moIndex >= 0) {
      for (const record of staffSource.records.rows) {
        if (record[0] !== moIndex) continue;
        const key = record[1] + ":" + record[2] + ":" + record[4];
        const group = grouped.get(key) ?? [];
        group.push(record);
        grouped.set(key, group);
      }
    }

    const rows: Row[] = [];
    for (const [mo, role, sp, noPosition, wrongDepartment] of staffSource.departments.rows) {
      if (mo !== moIndex) continue;
      const [spMo, spSuffix, spName] = staffSource.departments.sp[sp];
      if (spMo !== mo) throw new Error("Несоответствие OID МО в детализации ФРМР");
      const oid = spSuffix ? prefix + selectedId + ".0." + spSuffix : "Не указан";
      for (const item of [
        { category: "mo" as const, flag: 0, count: noPosition, reason: "Нет должности на уровне МО" },
        { category: "department" as const, flag: 1, count: wrongDepartment, reason: "Не совпадает привязка СП" },
      ]) {
        if (!item.count) continue;
        rows.push({
          key: item.category + ":" + role + ":" + sp,
          category: item.category, reason: item.reason,
          role: staffSource.departments.roles[role],
          frmrDepartment: spName, gisDepartment: "Сверить с ГИС", oid,
          count: item.count, source: "ФРМР ↔ ГИС", cut: staffSource.summary.sourceCut,
          flagged: true, staffRecords: grouped.get(role + ":" + sp + ":" + item.flag) ?? [],
        });
      }
    }
    if (auditRows) {
      for (let i = 0; i < auditRows.length; i++) {
        const row = auditRows[i];
        rows.push({
          key: "frmo:" + i, category: "frmo",
          reason: row.flags.length ? row.flags.map(flag => auditFlags[flag] ?? flag).join("; ") : "Признаков расхождения нет",
          role: "—", frmrDepartment: row.department || "Отделение не указано",
          gisDepartment: row.branchGis || "Филиал ГИС не указан",
          oid: row.departmentOid || row.oidFrmo || "Не указан", count: 1,
          source: "СП ↔ ФРМО", cut: auditRaw.sourceCut,
          flagged: row.flags.length > 0, auditRecord: row,
        });
      }
    }
    return {
      org, auditOrg, rows,
      stageMo: org ? org[5] : null,
      stageSp: org ? org[6] : null,
      total: org ? org[4] : null,
      flaggedFrmo: auditRows ? auditRows.filter(row => row.flags.length > 0).length : null,
      allFrmo: auditRows?.length ?? null,
    };
  }, [selectedId, selectedName]);

  const staffRows = data.rows.filter(row => row.category === "mo" || row.category === "department");
  const roleCounts = [...staffRows.reduce((map, row) => {
    const item = map.get(row.role) ?? { role: row.role, mo: 0, department: 0, total: 0 };
    if (row.category === "mo") item.mo += row.count;
    else item.department += row.count;
    item.total += row.count;
    map.set(row.role, item);
    return map;
  }, new Map<string, { role: string; mo: number; department: number; total: number }>()).values()]
    .sort((a, b) => b.total - a.total || a.role.localeCompare(b.role, "ru"));
  const matchingRoles = roleCounts.filter(item =>
    item.role.toLocaleLowerCase("ru").includes(roleSearch.trim().toLocaleLowerCase("ru")));

  // Default to the largest group and its first СП so the staff list is visible on entry.
  // A new MO remounts the workspace with key={selected.id} in the parent.
  const activeRole = drillRole && matchingRoles.some(item => item.role === drillRole) ? drillRole : matchingRoles[0]?.role ?? null;
  const roleRows = staffRows.filter(row => row.role === activeRole);
  const departmentGroups = [...roleRows.reduce((map, row) => {
    const item = map.get(row.oid) ?? { oid: row.oid, name: row.frmrDepartment, mo: 0, department: 0 };
    if (row.category === "mo") item.mo += row.count;
    else item.department += row.count;
    map.set(row.oid, item);
    return map;
  }, new Map<string, { oid: string; name: string; mo: number; department: number }>()).values()]
    .sort((a, b) => (b.mo + b.department) - (a.mo + a.department) || a.name.localeCompare(b.name, "ru"));
  const activeOid = drillOid && departmentGroups.some(dep => dep.oid === drillOid) ? drillOid : departmentGroups[0]?.oid ?? null;
  const activeDepartment = departmentGroups.find(dep => dep.oid === activeOid);
  const selectedStaffRows = roleRows.filter(row => row.oid === activeOid && (drillIssue === "all" || row.category === drillIssue));
  const employeeRecords = selectedStaffRows.flatMap(row =>
    (row.staffRecords ?? []).map(record => ({ record, category: row.category })))
    .sort((a, b) => a.record[5] - b.record[5]);
  const trimmedLast4 = last4Query.replace(/\D/g, "").slice(0, 4);
  const filteredEmployees = employeeRecords.filter(({record}) =>
    !trimmedLast4 || (record[3] !== null && record[3].includes(trimmedLast4)));

  const auditDisplay = data.rows.filter(row => row.category === "frmo" &&
    (!onlyAuditIssues || row.flagged) &&
    (!auditSearch.trim() || (row.reason + " " + row.frmrDepartment + " " + row.gisDepartment + " " + row.oid +
      " " + (row.auditRecord?.branchFrmo ?? "")).toLocaleLowerCase("ru")
      .includes(auditSearch.trim().toLocaleLowerCase("ru"))));
  const activeAudit = auditDisplay.find(row => row.key === selectedAuditKey) ?? auditDisplay[0] ?? null;

  function saveCsv() {
    const header = ["Тип", "Проблема", "Должность", "Подразделение ФРМР", "Подразделение ГИС/ФРМО", "OID", "Количество", "Источник", "Дата"];
    const exported = workspaceTab === "staff" ? staffRows : auditDisplay;
    const values = [header, ...exported.map(row => [
      row.category, row.reason, row.role, row.frmrDepartment, row.gisDepartment,
      row.oid, String(row.count), row.source, row.cut,
    ])];
    const csv = "\ufeff" + values.map(line => line.map(value => {
      // Prevent CSV spreadsheet formula execution from untrusted source labels.
      const safe = /^[=+@-]/.test(String(value)) ? "'" + value : String(value);
      return '"' + safe.replace(/"/g, '""') + '"';
    }).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "frmr-mo-" + selectedId + "-" + workspaceTab + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.workspace} data-testid="frmr-unified-mo-workspace">
    <div className={styles.heading}>
      <div>
        <h2>Все расхождения выбранной МО</h2>
        <p>Одна рабочая панель: должность → СП → конкретные записи. Данные ФРМО доступны отдельной вкладкой.</p>
      </div>
      <button type="button" className={styles.exportButton} onClick={saveCsv}>Экспорт CSV</button>
    </div>

    <div className={styles.stats}>
      <article><span>Расхождения ФРМР</span><strong>{format(data.total)}</strong><small>Должностных записей · {staffSource.summary.sourceCut}</small></article>
      <article><span>На уровне МО</span><strong>{format(data.stageMo)}</strong><small>Должность не найдена в ГИС</small></article>
      <article><span>Привязки СП</span><strong>{format(data.stageSp)}</strong><small>Не совпало подразделение</small></article>
      <article><span>Сверка СП с ФРМО</span><strong>{format(data.flaggedFrmo)}</strong><small>Строк для проверки · {auditRaw.sourceCut}</small></article>
    </div>
    {!data.auditOrg && <p className={styles.warning} role="status">Эта МО не сопоставлена однозначно с данными сверки ФРМО. Данные отсутствуют, не нулевые. Проверьте OID.</p>}
    <nav className={styles.tabs} aria-label="Рабочие таблицы медицинской организации">
      <button type="button" className={workspaceTab === "staff" ? styles.tabActive : ""}
        aria-pressed={workspaceTab === "staff"} onClick={() => setWorkspaceTab("staff")}>Должности ФРМР</button>
      <button type="button" className={workspaceTab === "frmo" ? styles.tabActive : ""}
        aria-pressed={workspaceTab === "frmo"} onClick={() => setWorkspaceTab("frmo")}>Сверка СП с ФРМО</button>
    </nav>

    {workspaceTab === "staff" ? <section className={styles.drillCard} data-testid="frmr-person-drilldown">
      <div className={styles.drillGrid}>
        <div className={styles.drillColumn}>
          <div className={styles.columnHead}><h3>1. Должности</h3><small>{format(roleCounts.length)} проблемных должностей</small></div>
          <input type="search" className={styles.drillInput} value={roleSearch} onChange={event => setRoleSearch(event.target.value)}
            placeholder="Поиск должности" aria-label="Поиск должностей ФРМР"/>
          <div className={styles.drillOptions}>
            {matchingRoles.map(item => <button type="button" key={item.role} aria-pressed={activeRole === item.role}
              className={activeRole === item.role ? styles.drillSelected : ""}
              onClick={() => { setDrillRole(item.role); setDrillOid(null); setDrillIssue("all"); setLast4Query(""); setRecordsShown(50); }}>
              <span><strong>{item.role}</strong><small>МО: {format(item.mo)} · СП: {format(item.department)}</small></span>
              <b>{format(item.total)}</b>
            </button>)}
            {!matchingRoles.length && <p className={styles.drillHint}>Должностей по запросу нет.</p>}
          </div>
        </div>
        <div className={styles.drillColumn}>
          <div className={styles.columnHead}><h3>2. Подразделения</h3><small>{activeRole ?? "Нет данных"}</small></div>
          {activeRole ? <div className={styles.drillOptions}>
            {departmentGroups.map(dep => <button type="button" key={dep.oid} aria-pressed={activeOid === dep.oid}
              className={activeOid === dep.oid ? styles.drillSelected : ""}
              onClick={() => { setDrillOid(dep.oid); setDrillIssue("all"); setLast4Query(""); setRecordsShown(50); }}>
              <span><strong>{dep.name}</strong><small>OID: {dep.oid}</small>
                <small>МО: {format(dep.mo)} · СП: {format(dep.department)}</small></span>
              <b>{format(dep.mo + dep.department)}</b>
            </button>)}
          </div> : <p className={styles.drillHint}>По выбранной МО расхождений ФРМР нет.</p>}
        </div>
        <div className={styles.drillColumn}>
          <div className={styles.columnHead}><h3>3. Записи сотрудников</h3>
            <small>{activeDepartment?.name ?? "Выберите СП"} · {format(employeeRecords.length)} записей</small></div>
          {activeOid ? <>
            <div className={styles.drillFilters} role="group" aria-label="Тип расхождения по сотрудникам">
              {([["all","Все"],["mo","На уровне МО"],["department","Привязки СП"]] as const).map(([value,label]) =>
                <button type="button" key={value} aria-pressed={drillIssue === value}
                  className={drillIssue === value ? styles.drillSelected : ""}
                  onClick={() => { setDrillIssue(value); setRecordsShown(50); }}>{label}</button>)}
            </div>
            <input className={styles.drillInput} type="search" inputMode="numeric" maxLength={4}
              value={last4Query} onChange={event => {setLast4Query(event.target.value.replace(/\D/g,"").slice(0,4));setRecordsShown(50);}}
              placeholder="Последние 4 цифры СНИЛС" aria-label="Поиск по последним четырём цифрам СНИЛС"/>
            <div className={styles.employeeScroll}>
              <table className={styles.employeeTable}>
                <thead><tr><th>Строка</th><th>СНИЛС</th><th>Причина</th></tr></thead>
                <tbody>{filteredEmployees.slice(0,recordsShown).map(({record,category},index) =>
                  <tr key={record[5] + "-" + index}>
                    <td>№ {record[5]}</td>
                    <td className={styles.maskedSnils}>{record[3]===null ? "Нет данных" : "•••-•••-•"+record[3]}</td>
                    <td>{category === "mo" ? "Нет должности в МО" : "Не совпадает СП"}</td>
                  </tr>)}</tbody>
              </table>
            </div>
            {!filteredEmployees.length && <p className={styles.drillHint}>Записей по выбранным условиям нет.</p>}
            <div className={styles.recordsFooter}><span>Показано {format(Math.min(recordsShown,filteredEmployees.length))} из {format(filteredEmployees.length)}</span>
              {recordsShown < filteredEmployees.length &&
                <button type="button" onClick={() => setRecordsShown(n => n + 50)}>Показать ещё 50</button>}</div>
          </> : <p className={styles.drillHint}>Выберите должность и подразделение. Детализация ФРМР недоступна без соответствующей записи.</p>}
        </div>
      </div>
      <p className={styles.sourceNote}>Выберите должность и подразделение — справа сразу появятся должностные записи. СНИЛС отображается только в маскированном виде. Единица учёта — должностная запись, не уникальный человек.</p>
    </section> : <section className={styles.auditCard} data-testid="frmr-frmo-audit-table">
      <div className={styles.auditTools}>
        <div><h3>Сверка подразделений с ФРМО</h3><p>Признаки расхождений — повод для проверки, а не подтверждённая ошибка МО.</p></div>
        <input type="search" className={styles.drillInput} value={auditSearch}
          onChange={event => setAuditSearch(event.target.value)} placeholder="Поиск подразделения или OID" aria-label="Поиск подразделений ФРМО"/>
        <button type="button" className={styles.auditFilter} aria-pressed={onlyAuditIssues}
          onClick={() => {setOnlyAuditIssues(value => !value);setSelectedAuditKey(null);}}>
          {onlyAuditIssues ? "✓ Только для проверки" : "Показать только расхождения"}
        </button>
      </div>
      <div className={styles.auditTableScroll}>
        <table className={styles.auditTable}>
          <thead><tr><th>Структурное подразделение</th><th>Филиал ГИС</th><th>Филиал ФРМО</th><th>OID</th><th>Признак</th></tr></thead>
          <tbody>{auditDisplay.map(row => <tr key={row.key} className={activeAudit?.key === row.key ? styles.auditSelected : ""}>
            <td><button type="button" className={styles.auditRowButton} onClick={() => setSelectedAuditKey(row.key)}>{row.frmrDepartment}</button></td>
            <td>{row.gisDepartment}</td>
            <td>{row.auditRecord?.branchFrmo || "Нет данных"}</td>
            <td className={styles.auditOid}>{row.oid}</td>
            <td><span className={row.flagged ? styles.auditFlag : styles.auditClean}>{row.flagged ? "Проверить" : "Без признаков"}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!auditDisplay.length && <p className={styles.empty}>Нет строк по выбранным условиям. Если МО не сопоставлена с ФРМО, данные не подменяются нулём.</p>}
      {activeAudit && <div className={styles.auditDetail}>
        <h4>{activeAudit.frmrDepartment}</h4>
        <p><b>Признак:</b> {activeAudit.reason}</p>
        <p><b>OID подразделения:</b> <code>{activeAudit.oid}</code></p>
        <p><b>OID ФРМО:</b> <code>{activeAudit.auditRecord?.oidFrmo || "Не указан"}</code></p>
        <p><b>Филиал ГИС:</b> {activeAudit.gisDepartment} · <b>Филиал ФРМО:</b> {activeAudit.auditRecord?.branchFrmo || "Нет данных"}</p>
        <p><b>Привязка СП:</b> {activeAudit.auditRecord?.departmentBranch || "Нет данных"}</p>
        <small>Название, OID или исключение СП сверяются по первичному источнику и дате; автоматически нарушением МО не считаются.</small>
      </div>}
    </section>}

    <details className={styles.accordion}><summary>Источники и история срезов</summary>
      <p>ФРМР ↔ ГИС: {staffSource.summary.sourceCut}. Сверка СП с ФРМО: {auditRaw.sourceCut}.</p>
      {data.auditOrg && <p>Строк в срезах СП: {format(data.auditOrg.current)} на {auditRaw.sourceCut}; {format(data.auditOrg.previous)} на {auditRaw.previousCut}; {format(data.auditOrg.old)} на {auditRaw.historicCut}. Это состав строк, а не динамика исправленных ошибок.</p>}
      <p>Расхождения ФРМР — должностные записи; строки ФРМО — иная единица учёта, их нельзя суммировать. Отсутствие данных не равно нулю.</p>
    </details>
  </div>;
}
