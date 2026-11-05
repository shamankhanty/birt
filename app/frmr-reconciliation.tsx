"use client";

import { useMemo, useState } from "react";
import legacyRaw from "./frmr-reconciliation-data.json";
import allRaw from "./frmr-all-specialties.json";
import spTypes from "./frmr-sp-types.json";
import previousControl from "./frmr-previous-control.json";
import { compareFrmrControl, frmrControlView } from "../lib/frmr-control";
import FrmoLinkage from "./frmo-linkage";
import { applyFrmrScope } from "../lib/frmr-scope";
const { data: scopedAll, excluded: scopeExcluded } = applyFrmrScope(allRaw, spTypes.types);
import legacyDepartments from "./frmr-department-details.json";
import legacyRecords from "./frmr-last4-records.json";
import styles from "./frmr-reconciliation.module.css";

type DepartmentGroup = { mo: string; role: string; name: string; oid: string; moIndex: number; roleIndex: number; spIndex: number; noPosition: number; wrongDepartment: number; count: number };
type StaffRecord = [number, number, number, string | null, number, number, number?];
const officialPrefix = "1.2.643.5.1.13.13.12.2.16.";
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

export default function FrmrReconciliation() {
  const [coverage, setCoverage] = useState<"all" | "legacy">("all");
  const isAll = coverage === "all";
  const [controlLevel, setControlLevel] = useState<"mo" | "department">("mo");
  const [spType, setSpType] = useState("");
  const controlData = useMemo(() => frmrControlView(scopedAll, controlLevel, spType, spTypes.types), [controlLevel, spType]);
  const comparison = useMemo(() => compareFrmrControl(previousControl, controlData, controlLevel, spType), [controlData, controlLevel, spType]);
  const raw = isAll ? controlData.summary : legacyRaw;
  const departmentRaw = isAll ? controlData.departments : legacyDepartments;
  const last4Raw = isAll ? controlData.records : legacyRecords;
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
  const orgs: Org[] = (raw.rows as unknown as PositionRecord[]).map(
    ([id, name, feb, previous, current, stage1, stage2, positions, specialties]) =>
      ({ id, name, feb, previous: isAll ? comparison.byMo[id] ?? null : previous, current, stage1, stage2, positions, specialties }),
  );
  const topSpecialties = raw.topSpecialties as unknown as SpecialityGroup[];
  const sortedOrgs = [...orgs].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const cutShort = isAll ? allRaw.summary.sourceCut.slice(0,5) : "22.10";
  const dateLabel = isAll ? allRaw.summary.sourceCut + " · все специальности" : "22.10.2026 · архив прежнего перечня";
  const [view, setView] = useState<"minister" | "organization" | "linkage">("minister");
  const [filter, setFilter] = useState<"all" | "worse" | "better" | "missing" | "zero">("all");
  const [sort, setSort] = useState<"count" | "worsening" | "improving" | "name">("count");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moQuery, setMoQuery] = useState("");
  const [moSearchOpen, setMoSearchOpen] = useState(false);
  const [moHighlight, setMoHighlight] = useState(0);
  const [roleQuery, setRoleQuery] = useState("");
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [inspectionType, setInspectionType] = useState<"all" | "mo" | "department">("all");
  const [last4Query, setLast4Query] = useState("");

  const selected = orgs.find((row) => row.id === selectedId) ?? null;
  const moMatches = sortedOrgs.filter((row) => {
    const q = moQuery.trim().toLocaleLowerCase("ru");
    return Boolean(q) && (row.name.toLocaleLowerCase("ru").includes(q) ||
      row.id.includes(q) || (officialPrefix + row.id).includes(q));
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
  }, [coverage, controlLevel, spType, filter, search, sort]);

  const allSelectedGroups = departmentRows.filter((row) => row.mo === selected?.id);
  const diagnosticRoles: SpecialityGroup[] = [...allSelectedGroups.reduce((map, row) => {
    map.set(row.role, (map.get(row.role) ?? 0) + row.count);
    return map;
  }, new Map<string,number>()).entries()]
    .filter(([role]) => role.toLocaleLowerCase("ru").includes(roleQuery.trim().toLocaleLowerCase("ru")))
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"ru"));
  const roleDepartments = allSelectedGroups.filter((row) => row.role === activeRole)
    .sort((a,b) => b.count-a.count || a.name.localeCompare(b.name,"ru"));
  const selectedRoleIndices = new Set(roleDepartments.map(row => row.roleIndex));
  const moRoleRecords = staffRecords.filter(rec => selected && departmentRaw.mos[rec[0]] === selected.id && selectedRoleIndices.has(rec[1]));
  const visibleMoRecords = moRoleRecords.filter(rec => !last4Query.trim() || (rec[3] !== null && rec[3].includes(last4Query.replace(/\D/g,""))));
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
        <h1>ФРМР ↔ ГИС: достоверность должностей</h1>
        <p>Единый контроль расхождений между федеральным регистром и региональной ГИС. Основной контроль — наличие должности на уровне медицинской организации. Привязки подразделений доступны отдельно, справочно.</p>
        <div className={styles.heroBottom}>
          <span className={styles.eyebrow}>Срез {dateLabel}</span>
          <span className={styles.heroNote}>Единица учёта — должностная запись, а не уникальный сотрудник. Влияние на запись пациентов пока не подтверждено.</span>
        </div>
      </section>

      <div className={styles.tabs} role="group" aria-label="Охват ФРМР">
        <button className={[styles.tab, isAll ? styles.tabActive : ""].join(" ")} onClick={() => {setCoverage("all");setControlLevel("mo");setSpType("");setView("minister");setFilter("all");setSort("count");setSearch("");setMoQuery("");setSelectedId(null);resetInspection();}}>Все специальности · {allRaw.summary.sourceCut.slice(0,5)}</button>
        <button className={[styles.tab, !isAll ? styles.tabActive : ""].join(" ")} onClick={() => {setCoverage("legacy");setSpType("");setView("minister");setFilter("all");setSort("count");setSearch("");setMoQuery("");setSelectedId(null);resetInspection();}}>Прежний перечень · архив</button>
      </div>
      <div className={styles.tabs} role="group" aria-label="Представление раздела">
        <button className={[styles.tab, view === "minister" ? styles.tabActive : ""].join(" ")} onClick={() => setView("minister")} aria-pressed={view === "minister"}>Обзор</button>
        <button className={[styles.tab, view === "organization" ? styles.tabActive : ""].join(" ")} onClick={() => setView("organization")} aria-pressed={view === "organization"}>Карточка МО и действия</button>
        <button className={[styles.tab, view === "linkage" ? styles.tabActive : ""].join(" ")} onClick={() => setView("linkage")} aria-pressed={view === "linkage"}>Привязки ФРМО · 30.10</button>
      </div>

      {isAll && view !== "linkage" && <div className={styles.filters}>
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
      {isAll && view !== "linkage" && <p className={styles.muted} data-testid="frmr-control-note">{controlLevel === "mo" ? "Основной контроль: должность не найдена на уровне МО. Расхождения привязок СП в этот итог не входят." : "Справочно: должность найдена в МО, но не совпадает привязка СП. Эти записи не входят в основной итог проблем МО."} {spType && <>Тип СП: {spType}. </>}Все специальности сохранены с учётом согласованных исключений. Тип СП не определяет работу по ОМС или платно.</p>}

      {isAll && view !== "linkage" && <p className={styles.muted} data-testid="frmr-scope-note">Из сверки исключены: скорая помощь, врачи-стажёры и средний лабораторный персонал. Учтено {number(scopedAll.records.rows.length)} записей; исключено {number(scopeExcluded.total)}. Изменение охвата не является улучшением показателя.</p>}

      {view === "linkage" ? <FrmoLinkage /> : view === "minister" ? (
        <>
          <div className={styles.stats}>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? (controlLevel === "mo" ? "Не найдены в МО" : "Привязки СП · справочно") : <>Расхождения на {cutShort}</>}</span><strong className={isAll && controlLevel === "department" ? styles.dark : styles.negative}>{number(currentTotal)}</strong><small>{isAll ? <>должностных записей в выбранном перечне{comparison.missingBaseline === 0 && <> · {signed(comparison.currentTotal-comparison.previousTotal)} к {comparison.cut.slice(0,5)}</>}</> : <>снижение на {number(previousTotal - currentTotal)} к 16.10</>}</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll && controlLevel === "department" ? "МО со справочными записями" : "МО с расхождениями"}</span><strong>{affected} <span className={styles.muted}>/ {orgs.length}</span></strong><small>в проверяемом перечне</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? "Наименований должностей" : "Улучшили / ухудшили"}</span><strong>{isAll ? number(topSpecialties.length) : <><span className={styles.positive}>{improvedCount}</span> / <span className={styles.negative}>{worsenedCount}</span></>}</strong><small>{isAll ? "в выбранном перечне" : "изменение числа записей к 16.10"}</small></article>
            <article className={styles.stat}><span className={styles.statLabel}>{isAll ? "Всего в исходной сверке" : "Снижение с февраля"}</span><strong>{number(isAll ? scopedAll.records.rows.length : febTotal - currentTotal)}</strong><small>{isAll ? "после согласованных исключений; два уровня отдельно" : <>{number(febTotal)} → {number(currentTotal)}</>}</small></article>
          </div>
          {isAll && <details className={styles.qualityNote}><summary>Качество исходных записей и границы расчёта</summary><p>В исходнике {number(allRaw.metadata.parsedRows)} записей с расхождениями; после исключений в сверке — {number(scopedAll.records.rows.length)}. В выбранном режиме — {number(currentTotal)}. Ниже приведены признаки качества полного исходника. Дополнительные признаки не исключают записи автоматически и могут пересекаться: без корректного идентификатора — {allRaw.metadata.quality.missingIdentifier}; дата окончания работы наступила — {allRaw.metadata.quality.employmentEnded}; избыточных повторов по проверенным реквизитам — {allRaw.metadata.quality.repeatedRecordExtras}; нет служебной связи МО с ФРМО — {allRaw.metadata.quality.missingOrganizationLink}.</p><p>В исходнике {number(allRaw.metadata.sourceIssueCount)} отдельных признаков расхождения; одна должностная запись может содержать несколько. Поэтому они не суммируются как число сотрудников. Ставки не оцениваются. Состав включает государственные и частные МО; ведомственная принадлежность не выводится из названия.</p></details>}
          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><div><h2>{isAll ? (controlLevel === "mo" ? "Контроль на уровне МО" : "Справочная сверка СП") : "Динамика по республике"}</h2><span className={styles.muted}>{isAll ? "Все применимые специальности, включая единичные записи" : "Исторические точки только на датах, присутствующих в файле"}</span></div>{!isAll && <span className={styles.pill}>−{number(previousTotal - currentTotal)} за 6 дней</span>}</div>
              {trendBars(isAll ? [[comparison.cut.slice(0,5), comparison.previousTotal], [cutShort, comparison.currentTotal]] : [["01.02", febTotal], ["16.10", previousTotal], ["22.10", currentTotal]])}
              {isAll ? <p className={styles.muted}>Сравнение {comparison.cut} → {raw.sourceCut}: {signed(comparison.currentTotal-comparison.previousTotal)} записей по {comparison.comparableOrganizations} сопоставимым МО. Одинаковые исключения, выбранный уровень и тип СП применены к обоим срезам. Изменение числа записей не доказывает исправление конкретных сотрудников. {comparison.missingBaseline > 0 && <>Без предыдущего среза: {comparison.missingBaseline} МО; они не включены в динамику.</>}</p> : <div className={styles.legend}><span>От 16.10: <b>{signed(currentTotal - previousTotal)}</b></span><span>От 01.02: <b>{signed(currentTotal - febTotal)}</b></span></div>}
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
              <p className={styles.moPickerSteps}>{isAll && controlLevel === "mo" ? "МО → должность → записи для проверки" : "МО → должность → подразделение → записи для проверки"}</p>
              </>}
            </div>
            {selected && <div className={[styles.miniStats, isAll ? styles.moStats : ""].join(" ")}>
              <article><small>{isAll ? (controlLevel === "mo" ? "Не найдены в МО" : "СП · справочно") : <>Расхождения на {cutShort}</>}</small><b className={selected.current ? styles.negative : styles.positive}>{number(selected.current)}</b></article>
              <article><small>{isAll ? "Наименований должностей" : "Изменение к 16.10"}</small><b>{isAll ? selected.specialties.length : signed(change(selected))}</b></article>
              {!isAll && <><article><small>Отсутствует на уровне МО</small><b>{number(selected.stage1)}</b></article><article><small>Не совпадает подразделение</small><b>{number(selected.stage2)}</b></article></>}
            </div>}
          </section>

          {selected && <>
          <section className={styles.panel} data-testid="frmr-organization-diagnostic">
            <div className={styles.panelHead}>
              <div>
                <h2>Где искать расхождения — маршрут для МО</h2>
                <p className={styles.muted}>{isAll && controlLevel === "mo" ? "Выберите должность. Все её записи в выбранной МО появятся сразу; подразделение можно раскрыть справочно." : "Выберите должность и конкретное структурное подразделение. Ниже появятся записи с четырьмя последними цифрами СНИЛС, OID СП и способом исправления."}</p>
              </div>
              <span className={styles.pill}>Срез · {raw.sourceCut}</span>
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
                {isAll && controlLevel === "mo" ? <>
                  <h3>2. Записи на уровне МО</h3>
                  {activeRole ? <section data-testid="frmr-mo-records">
                    <p className={styles.muted}>Должность «{activeRole}»: {number(moRoleRecords.length)} записей. Сверьте сотрудника и должность в ФРМР и ГИС на уровне МО; установите, какая запись неактуальна. Не создавайте дубли автоматически.</p>
                    <input className={styles.input} type="search" value={last4Query} onChange={e=>setLast4Query(e.target.value)} placeholder="Найти по последним 4 цифрам…" aria-label="Поиск по последним четырем цифрам СНИЛС" inputMode="numeric" maxLength={4}/>
                    <div className={styles.frmrRecordTableWrap}><table className={styles.table}>
                      <thead><tr><th>Строка в выгрузке</th><th>СНИЛС (4 цифры)</th><th>Что проверить</th></tr></thead>
                      <tbody>{visibleMoRecords.map(rec=><tr key={rec[5]}>
                        <td>№ {rec[5]}</td><td className={styles.frmrLastFour}>{rec[3]===null ? "Нет СНИЛС" : "•••-•••-•"+rec[3]}</td>
                        <td><div className={styles.frmrCheckCell}>
                          <span className={styles.frmrCheckStatus}>Нет должности на уровне МО</span>
                          {Boolean(rec[6]) && <small>{Object.entries(allRaw.records.qualityBits).filter(([bit])=>(rec[6]??0)&Number(bit)).map(([,label])=>label).join("; ")}</small>}
                          <details><summary>Показать СП и OID</summary><span>{departmentRaw.sp[rec[2]][2]}</span><small>OID СП: {officialPrefix}{selected.id}.0.{departmentRaw.sp[rec[2]][1]}</small></details>
                        </div></td>
                      </tr>)}</tbody>
                    </table></div>
                    {!visibleMoRecords.length && <p className={styles.muted}>Записей по выбранному запросу нет.</p>}
                  </section> : <p className={styles.muted}>Выберите должность слева. Записи появятся без дополнительного выбора СП.</p>}
                </> : <>
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
                ) : <p className={styles.muted}>Выберите должность слева. Здесь появятся все её подразделения, включая единичные расхождения.</p>}
                </>}
              </div>
            </div>
            {(!isAll || controlLevel === "department") && <div className={styles.frmrDepartmentDetails}>
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
                    <button type="button" className={inspectionType==="all" ? styles.issueSelected : ""} onClick={()=>setInspectionType("all")}>Все записи · {number(selectedDepartment.count)}</button>
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
                        <p className={styles.muted}>Первые 7 цифр скрыты и отсутствуют в данных сайта. Номер строки помогает найти запись в исходной ведомости. Срез {raw.sourceCut}.</p>
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
                          <td>{isAll && Boolean(rec[6]) && <small className={styles.cellNote}>{Object.entries(allRaw.records.qualityBits).filter(([bit]) => (rec[6] ?? 0) & Number(bit)).map(([, label]) => label).join("; ")}</small>}
                          {rec[4]===0
                            ? "Сверить сотрудника и должность на уровне МО в ФРМР и ГИС; установить, какая запись неактуальна."
                            : "Сверить OID СП и филиала в ФРМР и ГИС; при спорном сопоставлении обратиться в РМИАЦ."}</td>
                        </tr>)}</tbody>
                      </table>
                      {visibleRecords.length===0 && <p className={styles.muted}>Записей с такими последними цифрами в выбранном подразделении нет.</p>}
                    </div>
                  </section>
                </>
              ) : <p className={styles.muted}>Выберите должность и подразделение выше. Будут показаны только подтверждённые для этого СП категории ошибок.</p>}
            </div>}
          </section>
          <div className={styles.grid}>
            <section className={styles.panel}>
              <h2>{isAll ? "Срез выбранной МО" : "Динамика выбранной МО"}</h2>
              {trendBars(isAll ? [...(selected.previous === null ? [] : [[comparison.cut.slice(0,5),selected.previous] as [string,number]]), [cutShort,selected.current]] : [["01.02",selected.feb??0],["16.10",selected.previous??0],["22.10",selected.current]])}
              <p className={styles.muted}>{isAll ? `Сравнение ${comparison.cut} → ${raw.sourceCut}: ${signed(change(selected))} записей. Те же исключения, уровень и тип СП. Отсутствие предыдущего среза обозначается «—».` : "Даты — контрольные точки из исходного файла. Сравнение не означает автоматически улучшение доступности записи."}</p>
              <h2 style={{marginTop:24}}>Распределение по должностям</h2>
              <p className={styles.muted}>{isAll ? "Показаны все должности с расхождениями, включая единичные группы." : "Архив: показаны группы с тремя и более записями."}</p>
              {selected.specialties.length ? selected.specialties.map(([name,count])=><div className={styles.spec} key={name}><span>{name.replace(/^- /,"")}</span><strong>{count}</strong></div>) : <p className={styles.muted}>{isAll ? "Должностей с расхождениями в представленном списке нет." : "Групп из трёх и более однотипных расхождений не выявлено."}</p>}
              {selected.current > selected.specialties.reduce((sum,[,n])=>sum+n,0) && <p className={styles.muted}>Остальные записи: {selected.current-selected.specialties.reduce((sum,[,n])=>sum+n,0)} — без раскрытия малочисленных категорий.</p>}
            </section>
            <section className={styles.panel}>
              <h2>{isAll && controlLevel === "department" ? "Справочная проверка СП" : "Что нужно сделать МО"}</h2>
              {(!isAll || controlLevel === "mo") && <div className={styles.action}><b className={styles.actionNum}>1</b><div><b>Проверить отсутствующие должности ({number(selected.stage1)})</b><span>Сверить кадровый приказ и фактическое трудоустройство, OID МО и запись в ГИС. Не создавать дубли автоматически.</span></div></div>}
              {(!isAll || controlLevel === "department") && <div className={styles.action}><b className={styles.actionNum}>2</b><div><b>Уточнить подразделения ({number(selected.stage2)})</b><span>Сопоставить подразделение из ФРМО, филиал, должность и фактическое место работы. Эта сверка не входит в основной итог проблем МО.</span></div></div>}
              <div className={styles.action}><b className={styles.actionNum}>3</b><div><b>Проверить запись пациентов</b><span>Выяснить, относится ли должность к амбулаторному приёму, есть ли расписание и опубликованы ли слоты на ЕПГУ.</span></div></div>
              <div className={styles.action}><b className={styles.actionNum}>4</b><div><b>Подтвердить исправление</b><span>Указать ответственного, срок, первопричину и результат повторной сверки.</span></div></div>
              <div className={styles.linkrow}>
                <button className={[styles.button,styles.ghost].join(" ")} type="button" onClick={()=>setView("minister")}>К общей сводке</button>
              </div>
            </section>
          </div>
          </>}
        </>
      )}
      <div className={styles.footnote}>
        Источник: {raw.source}. {isAll ? "Представлен список проблемных записей по всем специальностям; полнота общего кадрового состава для расчёта доли ошибок отдельно не подтверждена." : "Архив: проверено 7 279 должностных записей."} Мониторинг {orgs.length} МО.
        Сверка выполнена только в направлении ФРМР → ГИС. Обратная сверка и причинная связь с инцидентом № 38 пока не подтверждены.
        Раздел экспериментальный: текущие результаты не следует использовать для санкций или формального рейтинга МО.
      </div>
    </div>
  );
}
