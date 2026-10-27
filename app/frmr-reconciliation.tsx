"use client";

import { useMemo, useState } from "react";
import raw from "./frmr-reconciliation-data.json";
import departmentRaw from "./frmr-department-details.json";
import last4Raw from "./frmr-last4-records.json";
import styles from "./frmr-reconciliation.module.css";

type DepartmentGroup = { mo: string; role: string; name: string; oid: string; moIndex: number; roleIndex: number; spIndex: number; noPosition: number; wrongDepartment: number; count: number };
type StaffRecord = [number, number, number, string | null, number, number];
const staffRecords = last4Raw.rows as unknown as StaffRecord[];
const officialPrefix = "1.2.643.5.1.13.13.12.2.16.";
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
    oid: officialPrefix + mo + ".0." + spSuffix,
    noPosition,
    wrongDepartment,
    count: noPosition + wrongDepartment,
  };
});
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
const orgs: Org[] = (raw.rows as unknown as PositionRecord[]).map(
  ([id, name, feb, previous, current, stage1, stage2, positions, specialties]) =>
    ({ id, name, feb, previous, current, stage1, stage2, positions, specialties }),
);
const topSpecialties = raw.topSpecialties as unknown as SpecialityGroup[];
const number = (n: number | null | undefined) =>
  typeof n === "number" ? new Intl.NumberFormat("ru-RU").format(n) : "—";
const signed = (n: number | null) =>
  n === null ? "—" : (n > 0 ? "+" : "") + number(n);
const change = (row: Org) =>
  row.previous === null ? null : row.current - row.previous;
const sortedOrgs = [...orgs].sort((a, b) => a.name.localeCompare(b.name, "ru"));

export default function FrmrReconciliation() {
  const [view, setView] = useState<"minister" | "organization">("minister");
  const [filter, setFilter] = useState<"all" | "worse" | "better" | "missing" | "zero">("all");
  const [sort, setSort] = useState<"count" | "worsening" | "improving" | "name">("count");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("1094");
  const [moQuery, setMoQuery] = useState(() => sortedOrgs.find((row) => row.id === "1094")?.name ?? "");
  const [moSearchOpen, setMoSearchOpen] = useState(false);
  const [moHighlight, setMoHighlight] = useState(0);
  const [roleQuery, setRoleQuery] = useState("");
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [inspectionType, setInspectionType] = useState<"all" | "mo" | "department">("all");
  const [last4Query, setLast4Query] = useState("");

  const selected = orgs.find((row) => row.id === selectedId) ?? orgs[0];
  const moMatches = sortedOrgs.filter((row) => {
    const q = moQuery.trim().toLocaleLowerCase("ru");
    return !q || row.name.toLocaleLowerCase("ru").includes(q) ||
      row.id.includes(q) || (officialPrefix + row.id).includes(q);
  }).slice(0, 30);
  const previousTotal = orgs.reduce((sum, row) => sum + (row.previous ?? 0), 0);
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
      .filter((row) => row.name.toLocaleLowerCase("ru").includes(q) || row.id.includes(q))
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
  }, [filter, search, sort]);

  const allSelectedGroups = departmentRows.filter((row) => row.mo === selected.id);
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
        <span className={styles.tag}>● В разработке · Инцидент № 38</span>
        <h1>ФРМР ↔ ГИС: достоверность должностей врачей</h1>
        <p>Единый контроль расхождений между федеральным регистром и региональной ГИС. Для руководителя — масштаб, динамика и МО с ухудшением. Для МО — структура проблем и конкретные действия.</p>
        <div className={styles.heroBottom}>
          <span className={styles.eyebrow}>Срез 22.10.2026 · предыдущий 16.10.2026</span>
          <span className={styles.heroNote}>Единица учёта — должностная запись, а не уникальный врач. Влияние на запись пациентов пока не подтверждено.</span>
        </div>
      </section>

      <div className={styles.tabs} role="group" aria-label="Представление раздела">
        <button className={[styles.tab, view === "minister" ? styles.tabActive : ""].join(" ")} onClick={() => setView("minister")} aria-pressed={view === "minister"}>Обзор</button>
        <button className={[styles.tab, view === "organization" ? styles.tabActive : ""].join(" ")} onClick={() => setView("organization")} aria-pressed={view === "organization"}>Карточка МО и действия</button>
      </div>

      {view === "minister" ? (
        <>
          <div className={styles.stats}>
            <article className={styles.stat}><span className={styles.statLabel}>Расхождения на 22.10</span><strong className={styles.negative}>{number(currentTotal)}</strong><small>должностных записей · снижение на {number(previousTotal - currentTotal)} к 16.10</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>МО с расхождениями</span><strong>{affected} <span className={styles.muted}>/ {orgs.length}</span></strong><small>в проверяемом перечне</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>Улучшили / ухудшили</span><strong><span className={styles.positive}>{improvedCount}</span> / <span className={styles.negative}>{worsenedCount}</span></strong><small>изменение числа записей к 16.10</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>Снижение с февраля</span><strong className={styles.positive}>{number(febTotal - currentTotal)}</strong><small>{number(febTotal)} → {number(currentTotal)} · −{((febTotal - currentTotal) / febTotal * 100).toFixed(1).replace(".", ",")}%</small></article>
          </div>
          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><div><h2>Динамика по республике</h2><span className={styles.muted}>Исторические точки только на датах, присутствующих в файле</span></div><span className={styles.pill}>−{number(previousTotal - currentTotal)} за 6 дней</span></div>
              {trendBars([["01.02", febTotal], ["16.10", previousTotal], ["22.10", currentTotal]])}
              <div className={styles.legend}><span>От 16.10: <b>{signed(currentTotal - previousTotal)}</b></span><span>От 01.02: <b>{signed(currentTotal - febTotal)}</b></span></div>
            </section>
            <section className={styles.panel}>
              <h2>Причины расхождений</h2>
              <div className={styles.muted}>Две взаимоисключающие группы из методики исходной сверки</div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Должность отсутствует на уровне МО</span><strong>{number(stage1Total)}</strong></div><div className={styles.reasonTrack}><div className={[styles.reasonFill,styles.one].join(" ")} style={{width:(stage1Total/currentTotal*100)+"%"}} /></div></div>
              <div className={styles.reason}><div className={styles.reasonTop}><span>Не совпадает структурное подразделение</span><strong>{number(stage2Total)}</strong></div><div className={styles.reasonTrack}><div className={[styles.reasonFill,styles.two].join(" ")} style={{width:(stage2Total/currentTotal*100)+"%"}} /></div></div>
              <p className={styles.muted}>Обе категории требуют проверки фактического трудоустройства, OID МО, подразделения и должности; автоматическое изменение ФРМР недопустимо.</p>
            </section>
          </div>
          <section className={styles.panel}>
            <div className={styles.panelHead}><div><h2>Мониторинг медицинских организаций</h2><span className={styles.muted}>Нажмите на название МО, чтобы открыть её карточку. Сортировка по объёму — не рейтинг качества работы.</span></div><span className={styles.pill}>{number(filtered.length)} МО</span></div>
            <div className={styles.filters}>
              <input className={styles.input} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск МО или OID…" aria-label="Поиск МО"/>
              <select className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Фильтр по изменению">
                <option value="all">Все МО</option><option value="worse">Ухудшение</option><option value="better">Улучшение</option><option value="missing">Есть расхождения</option><option value="zero">Без расхождений</option>
              </select>
              <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Сортировка МО">
                <option value="count">По числу расхождений ↓</option><option value="worsening">По ухудшению ↓</option><option value="improving">По улучшению ↓</option><option value="name">По названию</option>
              </select>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Медицинская организация</th><th>16.10</th><th>22.10</th><th>Δ</th><th>Нет в МО</th><th>Не в СП</th></tr></thead>
                <tbody>{filtered.map((row) => {
                  const delta = change(row);
                  return <tr key={row.id}>
                    <td><button type="button" className={styles.clickName} onClick={() => {selectOrganization(row.id);setView("organization");}}>{row.name}</button></td>
                    <td>{number(row.previous)}</td><td><b>{number(row.current)}</b></td>
                    <td className={[styles.delta,delta === null || delta === 0 ? styles.stable : delta > 0 ? styles.bad : styles.good].join(" ")}>{signed(delta)}</td>
                    <td>{number(row.stage1)}</td><td>{number(row.stage2)}</td>
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
              <h2>Карточка медицинской организации</h2>
              <div className={styles.moSearchBox}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMoSearchOpen(false); }}>
                <input className={[styles.input, styles.moSearchInput].join(" ")} type="search"
                  value={moQuery} role="combobox" aria-label="Поиск медицинской организации"
                  aria-autocomplete="list" aria-expanded={moSearchOpen}
                  aria-controls="frmr-mo-search-results"
                  aria-activedescendant={moSearchOpen && moMatches.length ? "frmr-mo-option-" + moHighlight : undefined}
                  placeholder="Найти МО по названию или OID…"
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
                        key={row.id} aria-selected={row.id === selected.id}
                        className={[styles.moSearchOption, index === moHighlight ? styles.moSearchOptionActive : ""].join(" ")}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectOrganization(row.id)}>
                        <span>{row.name}</span><small>OID: {officialPrefix}{row.id}</small>
                      </button>
                    ) : <p className={styles.moSearchEmpty}>МО не найдена</p>}
                  </div>
                )}
              </div>
              <span className={styles.muted}>OID: 1.2.643.5.1.13.13.12.2.16.{selected.id}</span>
            </div>
            <div className={styles.miniStats}>
              <article><small>Расхождения на 22.10</small><b className={selected.current ? styles.negative : styles.positive}>{number(selected.current)}</b></article>
              <article><small>Изменение к 16.10</small><b className={change(selected)! > 0 ? styles.negative : styles.positive}>{signed(change(selected))}</b></article>
              <article><small>Отсутствует на уровне МО</small><b>{number(selected.stage1)}</b></article>
              <article><small>Не совпадает подразделение</small><b>{number(selected.stage2)}</b></article>
            </div>
          </section>

          <section className={styles.panel} data-testid="frmr-organization-diagnostic">
            <div className={styles.panelHead}>
              <div>
                <h2>Где искать расхождения — маршрут для МО</h2>
                <p className={styles.muted}>Выберите должность и конкретное структурное подразделение. Ниже появятся записи с четырьмя последними цифрами СНИЛС, OID СП и способом исправления.</p>
              </div>
              <span className={styles.pill}>Срез · 22.10.2026</span>
            </div>
            <div className={styles.diagnosticLayout}>
              <div>
                <h3>1. Должность ФРМР</h3>
                <div className={styles.privateTools}>
                  <input className={styles.input} type="search" value={roleQuery}
                    onChange={(e) => setRoleQuery(e.target.value)}
                    placeholder="Найти должность…" aria-label="Поиск по проблемным должностям"/>
                </div>
                <div className={styles.diagnosticRoles}>
                  {diagnosticRoles.map(([role, count]) => (
                    <button key={role} className={[styles.diagnosticRole, activeRole === role ? styles.diagnosticRoleActive : ""].join(" ")}
                      onClick={() => { setActiveRole(role); setActiveDepartment(null); setInspectionType("all"); setLast4Query("");  }}
                      type="button" aria-pressed={activeRole === role}>
                      <span>{role}</span><b>{number(count)} <small>зап.</small></b>
                    </button>
                  ))}
                  {!diagnosticRoles.length && <p className={styles.muted}>По запросу должности не найдены. Все должностные группы, включая единичные, доступны в перечне.</p>}
                </div>
                <p className={styles.muted}>Всего расхождений по всем должностям МО: <b>{number(allSelectedGroups.reduce((sum,r)=>sum+r.count,0))}</b>. Одна запись — не обязательно отдельный врач.</p>
              </div>
              <div className={styles.diagnosticGuide}>
                <h3>2. Структурное подразделение</h3>
                {activeRole ? (
                  <>
                    <p className={styles.muted}>Должность «{activeRole}»: {number(roleDepartments.reduce((sum,row)=>sum+row.count,0))} записей, {roleDepartments.length} СП. Выберите отделение, чтобы увидеть конкретные причины.</p>
                    <div className={styles.frmrDepartmentList}>
                      {roleDepartments.map((dep) => <button type="button" key={dep.oid}
                        className={[styles.frmrDepartment, selectedDepartment?.oid===dep.oid ? styles.frmrDepartmentActive : ""].join(" ")}
                        onClick={() => {setActiveDepartment(dep.oid);setInspectionType("all");setLast4Query("");}}>
                        <span><b>{dep.name}</b><small>OID СП: {dep.oid}</small><small>Нет должности: {number(dep.noPosition)} · не совпадает СП: {number(dep.wrongDepartment)}</small></span>
                        <strong>{number(dep.count)}</strong>
                      </button>)}
                    </div>
                  </>
                ) : <p className={styles.muted}>Выберите врачебную должность слева. Здесь появятся все её подразделения, включая единичные расхождения.</p>}
              </div>
            </div>
            <div className={styles.frmrDepartmentDetails}>
              <h3>3. Причина и как исправить</h3>
              {selectedDepartment ? (
                <>
                  <div className={styles.diagnosticRoute}>
                    <b>Точный адрес проверки</b>
                    <div><small>МО</small><strong>{selected.name}</strong></div>
                    <div><small>OID МО</small><code>{officialPrefix}{selected.id}</code></div>
                    <div><small>Должность ФРМР</small><strong>{activeRole}</strong></div>
                    <div><small>Структурное подразделение ФРМР</small><strong>{selectedDepartment.name}</strong></div>
                    <div><small>OID СП</small><code>{selectedDepartment.oid}</code></div>
                  </div>
                  <div className={styles.diagnosticIssueButtons} role="group" aria-label="Выбрать тип проблемы подразделения">
                    <button type="button" className={inspectionType==="all" ? styles.issueSelected : ""} onClick={()=>setInspectionType("all")}>Обе причины · {number(selectedDepartment.count)}</button>
                    <button type="button" className={inspectionType==="mo" ? styles.issueSelected : ""} onClick={()=>setInspectionType("mo")}>Нет должности · {number(selectedDepartment.noPosition)}</button>
                    <button type="button" className={inspectionType==="department" ? styles.issueSelected : ""} onClick={()=>setInspectionType("department")}>Не совпадает СП · {number(selectedDepartment.wrongDepartment)}</button>
                  </div>
                  {(inspectionType==="all" || inspectionType==="mo") && selectedDepartment.noPosition>0 && (
                    <div className={styles.action}><b className={styles.actionNum}>1</b><div><b>Нет должности на уровне МО в ГИС — {number(selectedDepartment.noPosition)} зап.</b>
                      <span>ФРМР → трудоустройство → OID МО → должность. В ГИС → сотрудники → должность в МО проверить наличие того же работника. Если ФРМР актуален, исправить ГИС; если кадровая запись устарела — исправить ФРМР. Дубликаты не создавать.</span>
                    </div></div>
                  )}
                  {(inspectionType==="all" || inspectionType==="department") && selectedDepartment.wrongDepartment>0 && (
                    <div className={styles.action}><b className={styles.actionNum}>2</b><div><b>Должность есть, но не совпадает СП — {number(selectedDepartment.wrongDepartment)} зап.</b>
                      <span>Сверить OID подразделения сотрудника в ФРМР с привязкой в ГИС. Если OID ФРМР соответствует филиалу, а не рабочему СП, направить на проверку правил сопоставления РМИАЦ прежде, чем требовать от МО исправлений.</span>
                    </div></div>
                  )}
                  {((inspectionType==="mo"&&selectedDepartment.noPosition===0)||(inspectionType==="department"&&selectedDepartment.wrongDepartment===0)) && (
                    <p className={styles.muted}>Для этого подразделения записей выбранного типа не выявлено.</p>
                  )}
                  <section className={styles.frmrEmployeeRecords} data-testid="frmr-snils-last4-records">
                    <div className={styles.frmrEmployeeHeader}>
                      <div>
                        <h4>4. Конкретные записи — СНИЛС (4 цифры)</h4>
                        <p className={styles.muted}>Первые 7 цифр скрыты и отсутствуют в данных сайта. Номер строки помогает найти запись в исходной ведомости. Срез 22.10.2026.</p>
                      </div>
                      <strong>{number(detailRecords.length)} записей</strong>
                    </div>
                    <input className={styles.input} type="search"
                      value={last4Query} onChange={(e)=>setLast4Query(e.target.value)}
                      placeholder="Найти по последним 4 цифрам…" aria-label="Поиск по последним четырем цифрам СНИЛС"
                      inputMode="numeric" maxLength={4}/>
                    <div className={styles.frmrRecordTableWrap}>
                      <table className={styles.table}>
                        <thead><tr><th>Строка в выгрузке</th><th>СНИЛС</th><th>Причина расхождения</th><th>Что проверить</th></tr></thead>
                        <tbody>{visibleRecords.map((rec,i)=><tr key={rec[5]+"-"+i}>
                          <td>№ {rec[5]}</td>
                          <td className={styles.frmrLastFour}>{rec[3]===null ? "Нет СНИЛС" : "•••-•••-•"+rec[3]}</td>
                          <td>{last4Raw.issues[rec[4]]}</td>
                          <td>{rec[4]===0
                            ? "Сверить сотрудника и должность на уровне МО в ФРМР и ГИС; установить, какая запись неактуальна."
                            : "Сверить OID СП и филиала в ФРМР и ГИС; при спорном сопоставлении обратиться в РМИАЦ."}</td>
                        </tr>)}</tbody>
                      </table>
                      {visibleRecords.length===0 && <p className={styles.muted}>Записей с такими последними цифрами в выбранном подразделении нет.</p>}
                    </div>
                  </section>
                </>
              ) : <p className={styles.muted}>Выберите должность и подразделение выше. Будут показаны только подтверждённые для этого СП категории ошибок.</p>}
            </div>
          </section>
          <div className={styles.grid}>
            <section className={styles.panel}>
              <h2>Динамика выбранной МО</h2>
              {trendBars([["01.02",selected.feb??0],["16.10",selected.previous??0],["22.10",selected.current]])}
              <p className={styles.muted}>Даты — контрольные точки из исходного файла. Сравнение не означает автоматически улучшение доступности записи.</p>
              <h2 style={{marginTop:24}}>Распределение по должностям</h2>
              <p className={styles.muted}>Для защиты персональных сведений показываются только группы с тремя и более записями. Мелкие группы не раскрываются поимённо.</p>
              {selected.specialties.length ? selected.specialties.map(([name,count])=><div className={styles.spec} key={name}><span>{name.replace(/^- /,"")}</span><strong>{count}</strong></div>) : <p className={styles.muted}>Групп из трёх и более однотипных расхождений не выявлено.</p>}
              {selected.current > selected.specialties.reduce((sum,[,n])=>sum+n,0) && <p className={styles.muted}>Остальные записи: {selected.current-selected.specialties.reduce((sum,[,n])=>sum+n,0)} — без раскрытия малочисленных категорий.</p>}
            </section>
            <section className={styles.panel}>
              <h2>Что нужно сделать МО</h2>
              <div className={styles.action}><b className={styles.actionNum}>1</b><div><b>Проверить отсутствующие должности ({number(selected.stage1)})</b><span>Сверить кадровый приказ и фактическое трудоустройство, OID МО и запись в ГИС. Не создавать дубли автоматически.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>2</b><div><b>Уточнить подразделения ({number(selected.stage2)})</b><span>Сопоставить подразделение из ФРМО, филиал, должность и фактическое место работы.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>3</b><div><b>Проверить запись пациентов</b><span>Выяснить, относится ли должность к амбулаторному приёму, есть ли расписание и опубликованы ли слоты на ЕПГУ.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>4</b><div><b>Подтвердить исправление</b><span>Указать ответственного, срок, первопричину и результат повторной сверки.</span></div></div>
              <div className={styles.linkrow}>
                <button className={[styles.button,styles.ghost].join(" ")} type="button" onClick={()=>setView("minister")}>К общей сводке</button>
              </div>
            </section>
          </div>
        </>
      )}
      <div className={styles.footnote}>
        Источник: {raw.source}. Проверено 7 279 должностных записей, мониторинг 137 МО.
        Сверка выполнена только в направлении ФРМР → ГИС. Обратная сверка и причинная связь с инцидентом № 38 пока не подтверждены.
        Раздел экспериментальный: текущие результаты не следует использовать для санкций или формального рейтинга МО.
      </div>
    </div>
  );
}
