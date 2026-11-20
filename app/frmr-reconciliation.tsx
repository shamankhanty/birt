"use client";

import { useMemo, useState } from "react";
import allRaw from "./frmr-all-specialties.json";
import moRegistry from "./mo-registry.json";
import spTypes from "./frmr-sp-types.json";
import previousControl from "./frmr-previous-control.json";
import FrmrSpAudit from "./frmr-sp-audit";
import FrmrMoWorkspace from "./frmr-mo-workspace";
import { compareFrmrControl, frmrControlView } from "../lib/frmr-control";
import { applyFrmrScope } from "../lib/frmr-scope";
const { data: scopedAll, excluded: scopeExcluded } = applyFrmrScope(allRaw, spTypes.types);
import styles from "./frmr-reconciliation.module.css";

type DepartmentGroup = { mo: string; role: string; name: string; oid: string; moIndex: number; roleIndex: number; spIndex: number; noPosition: number; wrongDepartment: number; count: number };
type StaffRecord = [number, number, number, string | null, number, number, number?];
const officialPrefix = "1.2.643.5.1.13.13.12.2.16.";
type Ownership = "state" | "private" | "unknown";
const STATE_MO_OIDS = new Set(moRegistry.organizations.map(row => row.oid));
// The three dental joint-stock organizations in the I38 state-participation view
// are identified by exact MO OIDs, not by the broad AO legal form.
const STATE_PARTICIPATION_AO_IDS = new Set(["1191", "14163", "63362"]);
const frmrOwnership = (id: string, name: string): Ownership => {
  if (STATE_MO_OIDS.has(officialPrefix + id) || STATE_PARTICIPATION_AO_IDS.has(id)) return "state";
  if (/^(ООО|ЧУЗ|АО|ИП|АНО|ЗАО|ОАО)(?=\s|["«]|$)/u.test(name.trim())) return "private";
  // An unrecognized OID cannot silently become private or governmental.
  return "unknown";
};
type SpecialityGroup = [string, number];
type PositionRecord = [
  string, string, number | null, number | null,
  number, number, number, number | null, SpecialityGroup[]
];
type Org = {
  id: string;
  name: string;
  feb: number | null;
  previous: number | null;
  current: number;
  stage1: number;
  stage2: number;
  positions: number | null;
  specialties: SpecialityGroup[];
};
const number = (n: number | null | undefined) =>
  typeof n === "number" ? new Intl.NumberFormat("ru-RU").format(n) : "—";
const signed = (n: number | null) =>
  n === null ? "—" : (n > 0 ? "+" : "") + number(n);
const change = (row: Org) =>
  row.previous === null ? null : row.current - row.previous;

export default function FrmrReconciliation({ targetOid = null }: { targetOid?: string | null }) {
  const initialMoId = targetOid?.startsWith(officialPrefix) ? targetOid.slice(officialPrefix.length) : null;
  const matchedInitialMoId = initialMoId && scopedAll.summary.rows.some(row => row[0] === initialMoId) ? initialMoId : null;
  const isAll = true;
  const [controlLevel, setControlLevel] = useState<"mo" | "department">("mo");
  const [spType, setSpType] = useState("");
  const controlData = useMemo(() => frmrControlView(scopedAll, controlLevel, spType, spTypes.types), [controlLevel, spType]);
  const comparison = useMemo(() => compareFrmrControl(previousControl, controlData, controlLevel, spType), [controlData, controlLevel, spType]);
  const raw = controlData.summary;
  const departmentRaw = controlData.departments;
  const last4Raw = controlData.records;
  const staffRecords = last4Raw.rows as unknown as StaffRecord[];
  const departmentRows: DepartmentGroup[] = (
    departmentRaw.rows as number[][]
  ).map(([moIndex, roleIndex, spIndex, noPosition, wrongDepartment]) => {
    const mo = departmentRaw.mos[moIndex];
    const [spMoIndex, spSuffix, spName] = departmentRaw.sp[spIndex] as [number, string, string];
    if (spMoIndex !== moIndex) throw new Error("Несоответствие OID МО при загрузке детализации ФРМР");
    return {
      mo,
      moIndex,
      roleIndex,
      spIndex,
      role: departmentRaw.roles[roleIndex].replace(/^Врач\s*-\s*/iu, "").replace(/^Врач\s+/iu, "").toLocaleLowerCase("ru"),
      name: spName,
      oid: spSuffix ? officialPrefix + mo + ".0." + spSuffix : "Не указан",
      noPosition,
      wrongDepartment,
      count: noPosition + wrongDepartment,
    };
  });
  const allOrgs: Org[] = (raw.rows as unknown as PositionRecord[]).map(
    ([id, name, feb, previous, current, stage1, stage2, positions, specialties]) =>
      ({ id, name, feb, previous: comparison.byMo[id] ?? null, current, stage1, stage2, positions, specialties }),
  );
  const [ownership, setOwnership] = useState<"state" | "private">(() => {
    if (!matchedInitialMoId) return "state";
    return frmrOwnership(matchedInitialMoId, allOrgs.find(row => row.id === matchedInitialMoId)?.name ?? "") === "private" ? "private" : "state";
  });
  const orgs = allOrgs.filter(row => frmrOwnership(row.id, row.name) === ownership);
  const unclassified = allOrgs.filter(row => frmrOwnership(row.id, row.name) === "unknown");
  const sortedOrgs = [...allOrgs].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const roleCounts = new Map<string, number>();
  for (const row of orgs) for (const [role, count] of row.specialties) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + count);
  }
  const topSpecialties: SpecialityGroup[] = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  // Full-scope source records (both stages), restricted by selected organization OIDs.
  const selectedMoIds = new Set(orgs.map(row => row.id));
  const selectedSourceCount = scopedAll.records.rows.filter(row =>
    selectedMoIds.has(scopedAll.departments.mos[row[0]])).length;
  const cutShort = allRaw.summary.sourceCut.slice(0,5);
  const dateLabel = allRaw.summary.sourceCut + " · все специальности";
  const [view, setView] = useState<"minister" | "organization" | "audit">(matchedInitialMoId ? "organization" : "minister");
  const [filter, setFilter] = useState<"all" | "worse" | "better" | "missing" | "zero">("all");
  const [sort, setSort] = useState<"count" | "worsening" | "improving" | "name">("count");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(matchedInitialMoId);
  const [moQuery, setMoQuery] = useState(() => matchedInitialMoId ? (scopedAll.summary.rows.find(row => row[0] === matchedInitialMoId)?.[1] ?? "") : "");
  const [moSearchOpen, setMoSearchOpen] = useState(false);
  const [moHighlight, setMoHighlight] = useState(0);
  const [roleQuery, setRoleQuery] = useState("");
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [inspectionType, setInspectionType] = useState<"all" | "mo" | "department">("all");
  const [last4Query, setLast4Query] = useState("");

  const selected = allOrgs.find((row) => row.id === selectedId) ?? null;
  const moMatches = sortedOrgs.filter((row) => {
    const q = moQuery.trim().toLocaleLowerCase("ru");
    return Boolean(q) && (row.name.toLocaleLowerCase("ru").includes(q) ||
      row.id.includes(q) || (officialPrefix + row.id).includes(q));
  }).slice(0, 30);
  const previousTotal = orgs.reduce((sum, row) => sum + (row.previous ?? 0), 0);
  const comparableOrgs = orgs.filter(row => row.previous !== null);
  const comparisonOverview = {
    cut: comparison.cut,
    previousTotal,
    currentTotal: comparableOrgs.reduce((sum, row) => sum + row.current, 0),
    comparableOrganizations: comparableOrgs.length,
    missingBaseline: orgs.length - comparableOrgs.length,
  };
  const currentTotal = orgs.reduce((sum, row) => sum + row.current, 0);
  const febTotal = orgs.reduce((sum, row) => sum + (row.feb ?? 0), 0);
  const stage1Total = orgs.reduce((sum, row) => sum + row.stage1, 0);
  const stage2Total = orgs.reduce((sum, row) => sum + row.stage2, 0);
  const affected = orgs.filter((row) => row.current > 0).length;
  const improvedCount = orgs.filter((row) => change(row) !== null && change(row)! < 0).length;
  const worsenedCount = orgs.filter((row) => change(row) !== null && change(row)! > 0).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru");
    return orgs
      .filter((row) => row.name.toLocaleLowerCase("ru").includes(q) || row.id.includes(q) || (officialPrefix + row.id).includes(q))
      .filter((row) =>
        filter === "all" ? true :
        filter === "worse" ? change(row) !== null && change(row)! > 0 :
        filter === "better" ? change(row) !== null && change(row)! < 0 :
        filter === "zero" ? row.current === 0 :
        row.current > 0,
      )
      .sort((a, b) =>
        sort === "worsening" ? ((change(b) ?? -Infinity) - (change(a) ?? -Infinity)) || b.current - a.current :
        sort === "improving" ? ((change(a) ?? Infinity) - (change(b) ?? Infinity)) || b.current - a.current :
        sort === "name" ? a.name.localeCompare(b.name, "ru") :
        b.current - a.current || a.name.localeCompare(b.name, "ru"),
      );
  }, [controlLevel, spType, filter, search, sort, ownership]);

  const allSelectedGroups = departmentRows.filter((row) => row.mo === selected?.id);
  const diagnosticRoles: SpecialityGroup[] = [...allSelectedGroups.reduce((map, row) => {
    map.set(row.role, (map.get(row.role) ?? 0) + row.count);
    return map;
  }, new Map<string,number>()).entries()]
    .filter(([role]) => role.toLocaleLowerCase("ru").includes(roleQuery.trim().toLocaleLowerCase("ru")))
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"ru"));
  const roleDepartments = allSelectedGroups.filter((row) => row.role === activeRole)
    .sort((a,b) => b.count-a.count || a.name.localeCompare(b.name,"ru"));
  const selectedDepartment = roleDepartments.find((row)=>row.oid===activeDepartment) ?? null;
  const detailRecords = selectedDepartment
    ? staffRecords.filter(([mo,role,sp,,issue]) =>
        mo === selectedDepartment.moIndex &&
        role === selectedDepartment.roleIndex &&
        sp === selectedDepartment.spIndex &&
        (inspectionType === "all" || (inspectionType === "mo" ? issue === 0 : issue === 1))
      )
    : [];
  const visibleRecords = detailRecords.filter((rec) =>
    !last4Query.trim() ||
    (rec[3] !== null && rec[3].includes(last4Query.replace(/\D/g,"")))
  );
  const resetInspection = () => {
    setRoleQuery("");
    setActiveRole(null);
    setActiveDepartment(null);
    setInspectionType("all");
    setLast4Query("");
  };
  const selectOrganization = (id: string) => {
    const row = sortedOrgs.find((item) => item.id === id);
    if (!row) return;
    setSelectedId(id);
    setMoQuery(row.name);
    setMoSearchOpen(false);
    setMoHighlight(0);
    resetInspection();
  };

  const trendBars = (values: [string, number][]) => (
    <div className={styles.trend}>
      {values.map(([label, value]) => (
        <div className={styles.trendRow} key={label}>
          <span>{label}</span>
          <div className={styles.track} aria-label={label + ": " + number(value)}>
            <div className={styles.bar} style={{ width: (value / Math.max(1, ...values.map(([, v]) => v)) * 100) + "%" }} />
          </div>
          <b>{number(value)}</b>
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.root} data-testid="frmr-reconciliation">
      <section className={styles.hero}>
        <span className={styles.tag}>ФРМР · ФРМО · ГИС</span>
        <h1>{view === "audit" ? "ФРМО ↔ ГИС: привязка подразделений" : "ФРМР ↔ ГИС: достоверность должностей"}</h1>
        <p>{view === "audit" ? "Справочная сверка филиалов и отделений с ФРМО. Признаки для проверки не влияют на основной показатель должностей." : "Единый контроль расхождений между федеральным регистром и региональной ГИС. Основной контроль — наличие должности на уровне медицинской организации. Привязки подразделений доступны отдельно, справочно."}</p>
        <div className={styles.heroBottom}>
          <span className={styles.eyebrow}>Срез {view === "audit" ? "19.11.2026 · все специальности" : dateLabel}</span>
          <span className={styles.heroNote}>{view === "audit" ? "Единица учёта — строка привязки отделения. Изменения состава СП проверяются по датированным срезам." : "Единица учёта — должностная запись, а не уникальный сотрудник. Влияние на запись пациентов пока не подтверждено."}</span>
        </div>
      </section>

      <div className={styles.workspaceControls}>
      <span className={styles.pill}>{view === "audit" ? "Привязки СП · 19.11" : `Все специальности · ${allRaw.summary.sourceCut.slice(0,5)}`}</span>
      <div className={styles.tabs} role="group" aria-label="Представление раздела">
        <button className={[styles.tab, view === "minister" ? styles.tabActive : ""].join(" ")} onClick={() => setView("minister")} aria-pressed={view === "minister"}>Обзор</button>
        <button className={[styles.tab, view === "organization" ? styles.tabActive : ""].join(" ")} onClick={() => setView("organization")} aria-pressed={view === "organization"}>Карточка МО · все ошибки</button>
      </div>

      {view === "minister" && <div className={styles.ownershipSwitch} role="group" aria-label="Форма собственности медицинских организаций">
        <button type="button" className={ownership === "state" ? styles.ownershipActive : ""}
          aria-pressed={ownership === "state"}
          onClick={() => { setOwnership("state"); setFilter("all"); setSearch(""); }}>Государственные</button>
        <button type="button" className={ownership === "private" ? styles.ownershipActive : ""}
          aria-pressed={ownership === "private"}
          onClick={() => { setOwnership("private"); setFilter("all"); setSearch(""); }}>Частные</button>
      </div>}
      {view === "minister" && <div className={styles.filters}>
        <div className={styles.tabs} role="group" aria-label="Уровень контроля ФРМР">
          <button className={[styles.tab, controlLevel === "mo" ? styles.tabActive : ""].join(" ")} aria-pressed={controlLevel === "mo"} onClick={() => {setControlLevel("mo");setFilter("all");resetInspection();}}>На уровне МО</button>
          <button className={[styles.tab, controlLevel === "department" ? styles.tabActive : ""].join(" ")} aria-pressed={controlLevel === "department"} onClick={() => {setControlLevel("department");setFilter("all");resetInspection();}}>Привязки СП · справочно</button>
        </div>
        <select className={styles.select} value={spType} aria-label="Тип структурного подразделения" onChange={e => {setSpType(e.target.value);resetInspection();}}>
          <option value="">Все типы СП</option>
          {[...new Set(Object.values(spTypes.types))].filter(type => type !== "Скорая медицинская помощь").sort((a,b)=>a.localeCompare(b,"ru")).map(type=><option key={type}>{type}</option>)}
          <option value="Не указан">Тип не указан</option>
        </select>
      </div>}
      </div>
      {view === "audit" ? <FrmrSpAudit /> : <>
      <details className={styles.scopeDetails}>
        <summary>Методика и охват сверки</summary>
        <p className={styles.muted} data-testid="frmr-control-note">{controlLevel === "mo" ? "Основной контроль: должность не найдена на уровне МО. Расхождения привязок СП в этот итог не входят." : "Справочно: должность найдена в МО, но не совпадает привязка СП. Эти записи не входят в основной итог проблем МО."} {spType && <>Тип СП: {spType}. </>}Все специальности сохранены с учётом согласованных исключений. Тип СП не определяет работу по ОМС или платно.</p>
        <p className={styles.muted} data-testid="frmr-scope-note">Из сверки исключены: скорая помощь, врачи-стажёры и средний лабораторный персонал. Учтено {number(scopedAll.records.rows.length)} записей; исключено {number(scopeExcluded.total)}. Изменение охвата не является улучшением показателя.</p>
      </details>

      {view === "minister" ? (
        <>
          {unclassified.length > 0 && <p className={styles.warning} role="status">
            Не определена категория для {number(unclassified.length)} МО. Они исключены из групповых итогов до проверки реестра и могут быть найдены в карточке МО.
          </p>}
          <div className={styles.stats}>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? (controlLevel === "mo" ? "Не найдены в МО" : "Привязки СП · справочно") : <>Расхождения на {cutShort}</>}</span><strong className={isAll && controlLevel === "department" ? styles.dark : styles.negative}>{number(currentTotal)}</strong><small>{isAll ? <>должностных записей в выбранном перечне{comparisonOverview.missingBaseline === 0 && <> · {signed(comparisonOverview.currentTotal-comparisonOverview.previousTotal)} к {comparisonOverview.cut.slice(0,5)}</>}</> : <>снижение на {number(previousTotal - currentTotal)} к 16.10</>}</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll && controlLevel === "department" ? "МО со справочными записями" : "МО с расхождениями"}</span><strong>{affected} <span className={styles.muted}>/ {orgs.length}</span></strong><small>в проверяемом перечне</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? "Наименований должностей" : "Улучшили / ухудшили"}</span><strong>{isAll ? number(topSpecialties.length) : <><span className={styles.positive}>{improvedCount}</span> / <span className={styles.negative}>{worsenedCount}</span></>}</strong><small>{isAll ? "в выбранном перечне" : "изменение числа записей к 16.10"}</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? "Всего в исходной сверке" : "Снижение с февраля"}</span><strong>{number(isAll ? selectedSourceCount : febTotal - currentTotal)}</strong><small>{isAll ? "в выбранной группе МО после исключений; два уровня отдельно" : <>{number(febTotal)} → {number(currentTotal)}</>}</small></article>
          </div>
          {isAll && <details className={styles.qualityNote}><summary>Качество исходных записей и границы расчёта</summary><p>В исходнике {number(allRaw.metadata.parsedRows)} записей с расхождениями; после исключений в сверке — {number(scopedAll.records.rows.length)}. В выбранном режиме — {number(currentTotal)}. Ниже приведены признаки качества полного исходника. Дополнительные признаки не исключают записи автоматически и могут пересекаться: без корректного идентификатора — {allRaw.metadata.quality.missingIdentifier}; дата окончания работы — {allRaw.metadata.quality.employmentEnded === null ? "не проверялась по этому источнику" : number(allRaw.metadata.quality.employmentEnded)}; избыточных повторов по проверенным реквизитам — {allRaw.metadata.quality.repeatedRecordExtras}; нет служебной связи МО с ФРМО — {allRaw.metadata.quality.missingOrganizationLink}.</p><p>В исходнике {number(allRaw.metadata.sourceIssueCount)} отдельных признаков расхождения; одна должностная запись может содержать несколько. Поэтому они не суммируются как число сотрудников. Ставки не оцениваются. Группы разделены по реестровым OID; три АО стоматологического профиля с участием РТ отнесены к государственной группе. Неопределённые МО не включаются автоматически.</p></details>}
          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><div><h2>{isAll ? (controlLevel === "mo" ? "Контроль на уровне МО" : "Справочная сверка СП") : "Динамика по республике"}</h2><span className={styles.muted}>{isAll ? "Все применимые специальности, включая единичные записи" : "Исторические точки только на датах, присутствующих в файле"}</span></div>{!isAll && <span className={styles.pill}>−{number(previousTotal - currentTotal)} за 6 дней</span>}</div>
              {trendBars(isAll ? [[comparisonOverview.cut.slice(0,5), comparisonOverview.previousTotal], [cutShort, comparisonOverview.currentTotal]] : [["01.02", febTotal], ["16.10", previousTotal], ["22.10", currentTotal]])}
              {isAll ? <p className={styles.muted}>Сравнение {comparisonOverview.cut} → {raw.sourceCut}: {signed(comparisonOverview.currentTotal-comparisonOverview.previousTotal)} записей по {comparisonOverview.comparableOrganizations} сопоставимым МО из выбранной группы. Одинаковые исключения, выбранный уровень и тип СП применены к обоим срезам. Изменение числа записей не доказывает исправление конкретных сотрудников. {comparisonOverview.missingBaseline > 0 && <>Без предыдущего среза: {comparisonOverview.missingBaseline} МО; они не включены в динамику.</>}</p> : <div className={styles.legend}><span>От 16.10: <b>{signed(currentTotal - previousTotal)}</b></span><span>От 01.02: <b>{signed(currentTotal - febTotal)}</b></span></div>}
            </section>
            <section className={styles.panel}>
              <h2>{isAll ? "Как читать результат" : "Причины расхождений"}</h2>
              {isAll ? <p className={styles.muted}>{controlLevel === "mo" ? "Сверьте сотрудника и должность на уровне МО. Выберите МО, затем должность — конкретные записи появятся сразу, без выбора подразделения." : "Привязки СП служат для поиска причин. Различие подразделений не означает отсутствия сотрудника в МО и не увеличивает основной итог."} Отсутствие должности не доказывает отсутствие СЭМД. Административные СП и платные услуги автоматически не исключаются.</p> : <>
              <div className={styles.muted}>Две взаимоисключающие группы: при отсутствии должности в МО запись учитывается на первом этапе, а не повторно в СП</div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Должность отсутствует на уровне МО</span><strong>{number(stage1Total)}</strong></div></div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Не совпадает структурное подразделение</span><strong>{number(stage2Total)}</strong></div></div>
              </>}
            </section>
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}><div><h2>Мониторинг медицинских организаций</h2><span className={styles.muted}>Нажмите на название МО, чтобы открыть её карточку. Сортировка по объёму — не рейтинг качества работы.</span></div><span className={styles.pill}>{number(filtered.length)} МО</span></div>
            <div className={styles.filters}>
              <input className={styles.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск МО или OID…" aria-label="Поиск МО"/>
              <select className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Фильтр по изменению">
                <option value="all">Все МО</option>{!isAll && <><option value="worse">Ухудшение</option><option value="better">Улучшение</option></>}<option value="missing">Есть расхождения</option><option value="zero">Без расхождений</option>
              </select>
              <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка МО">
                <option value="count">По числу расхождений ↓</option>{!isAll && <><option value="worsening">По ухудшению ↓</option><option value="improving">По улучшению ↓</option></>}<option value="name">По названию</option>
              </select>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Медицинская организация</th><th>{isAll ? comparison.cut.slice(0,5) : "16.10"}</th><th>{isAll ? (controlLevel === "mo" ? "Не найдены в МО" : "Привязки СП · справочно") : cutShort}</th><th>Δ</th>{!isAll && <><th>Нет в МО</th><th>Не в СП</th></>}</tr></thead>
                <tbody>{filtered.map((row) => {
                  const delta = change(row);
                  return <tr key={row.id}>
                    <td><button type="button" className={styles.clickName} onClick={() => {selectOrganization(row.id);setView("organization");}}>{row.name}</button></td>
                    <td>{number(row.previous)}</td><td><b>{number(row.current)}</b></td>
                    <td className={[styles.delta,delta === null || delta === 0 ? styles.stable : delta > 0 ? styles.bad : styles.good].join(" ")}>{signed(delta)}</td>
                    {!isAll && <><td>{number(row.stage1)}</td><td>{number(row.stage2)}</td></>}
                  </tr>;
                })}</tbody>
              </table>
              {filtered.length === 0 && <p className={styles.muted}>По выбранным фильтрам МО не найдены.</p>}
            </div>
          </section>
          <section className={styles.panel}>
            <h2>Должности с наибольшим числом расхождений</h2>
            <p className={styles.muted}>Показатели относятся к наименованиям должностей ФРМР, не к квалификационным сертификатам.</p>
            {topSpecialties.slice(0,8).map(([name,count]) => <div className={styles.spec} key={name}><span>{name}</span><strong>{number(count)}</strong></div>)}
          </section>
        </>
      ) : (
        <>
          <section className={styles.panel}>
            <div className={styles.moHeader}>
              <div className={styles.moSelectionHead}>
                <h2>{selected ? selected.name : "Выберите медицинскую организацию"}</h2>
                {selected && <button className={[styles.button, styles.ghost].join(" ")} type="button" onClick={() => {setSelectedId(null);setMoQuery("");setMoSearchOpen(false);resetInspection();}}>Сменить МО</button>}
              </div>
              {selected ? <span className={styles.muted}>OID: {officialPrefix}{selected.id}</span> : <>
              <label className={styles.moPickerLabel} htmlFor="frmr-mo-picker">Найдите свою МО по названию или OID</label>
              <div className={styles.moSearchBox}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMoSearchOpen(false); }}>
                <svg className={styles.moSearchIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
                <input id="frmr-mo-picker" autoFocus className={[styles.input, styles.moSearchInput].join(" ")} type="search"
                  value={moQuery} role="combobox" aria-label="Поиск медицинской организации"
                  aria-autocomplete="list" aria-expanded={moSearchOpen}
                  aria-controls="frmr-mo-search-results"
                  aria-activedescendant={moSearchOpen && moMatches.length ? "frmr-mo-option-" + moHighlight : undefined}
                  placeholder="Начните вводить название МО или OID"
                  onFocus={(e) => { setMoSearchOpen(true); setMoHighlight(0); e.currentTarget.select(); }}
                  onChange={(e) => { setMoQuery(e.target.value); setMoSearchOpen(true); setMoHighlight(0); }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setMoSearchOpen(false); return; }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setMoSearchOpen(true);
                      setMoHighlight((index) => moMatches.length
                        ? (index + (e.key === "ArrowDown" ? 1 : -1) + moMatches.length) % moMatches.length : 0);
                    }
                    if (e.key === "Enter" && moSearchOpen && moMatches[moHighlight]) {
                      e.preventDefault();
                      selectOrganization(moMatches[moHighlight].id);
                    }
                  }}/>
                {moSearchOpen && (
                  <div className={styles.moSearchResults} id="frmr-mo-search-results" role="listbox"
                    aria-label="Найденные медицинские организации">
                    {moMatches.length ? moMatches.map((row, index) =>
                      <button type="button" role="option" id={"frmr-mo-option-" + index}
                        key={row.id} aria-selected={row.id === selectedId}
                        className={[styles.moSearchOption, index === moHighlight ? styles.moSearchOptionActive : ""].join(" ")}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectOrganization(row.id)}>
                        <span>{row.name}</span><small>OID: {officialPrefix}{row.id}</small>
                      </button>
                    ) : <p className={styles.moSearchEmpty}>{moQuery.trim() ? "МО не найдена. Проверьте название или OID." : "Начните вводить название своей МО или OID."}</p>}
                  </div>
                )}
              </div>
              <p className={styles.moPickerSteps}>МО → все ошибки по должностям, подразделениям и ФРМО в одной карточке</p>
              </>}
            </div>
          </section>
          {selected && <FrmrMoWorkspace key={selected.id} selectedId={selected.id} selectedName={selected.name} />}
        </>
      )}
      <div className={styles.footnote}>
        Источник: {raw.source}. {isAll ? "Представлен список проблемных записей по всем специальностям; полнота общего кадрового состава для расчёта доли ошибок отдельно не подтверждена." : "Архив: проверено 7 279 должностных записей."} Мониторинг {orgs.length} МО.
        Сверка выполнена только в направлении ФРМР → ГИС. Обратная сверка и причинная связь с инцидентом № 38 пока не подтверждены.
        Раздел экспериментальный: текущие результаты не следует использовать для санкций или формального рейтинга МО.
      </div>
      </>}
    </div>
  );
}
