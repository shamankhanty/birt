"use client";

import { useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import reorganizationRaw from "../config/mo-reorganizations.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type Tab = "overview" | "organization";
type Ownership = "state" | "private";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const reorganizationGroups = (reorganizationRaw as { groups?: Array<{ effectiveDate: string; predecessors?: Array<{ oldOid?: string }> }> }).groups ?? [];
const dateKey = (date: string) => {
  const [day, month, year] = date.split(".");
  return `${year}-${month}-${day}`;
};
const ORGANIZATIONS = DATA.flatMap((dataset) => {
  const reportDate = dateKey(dataset.reportDate);
  const predecessorOids = new Set(reorganizationGroups
    .filter((group) => reportDate >= group.effectiveDate)
    .flatMap((group) => (group.predecessors ?? []).map((predecessor) => predecessor.oldOid).filter((oid): oid is string => Boolean(oid))));
  return dataset.orgs.filter((org) => !predecessorOids.has(org.oid));
});
const SPECIALTIES = [...new Map(DATA.flatMap((dataset) => dataset.specialties).map((specialty) => [specialty.code, specialty])).values()];
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const shortfall = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, norm - slots);
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
// The three AO dental organizations in these exports have documented Republic of Tatarstan participation.
// Keep them in the public/state-participation view; classify private entities by their legal-form prefixes.
const isPrivateOrganization = (org: Organization) => /^(ООО|ЧУЗ|ИП|АНО|ЗАО|ОАО|НЧОУ)\s/i.test(org.name.trim());
const rowsFor = (org: Organization) => org.specialties.filter((row) => row.norm === null || row.norm > 0);

function metrics(rows: Specialty[]) {
  const applicable = rowsFor({ specialties: rows } as Organization);
  const norm = sumKnown(applicable.map((row) => row.norm));
  const epguSlots = sumKnown(applicable.map((row) => row.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const allValuesPresent = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
  const deficit = allValuesPresent ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
  const quotaRows = applicable.filter((row) => row.epguNorm === null || row.epguNorm > 0);
  const quotaNorm = sumKnown(quotaRows.map((row) => row.epguNorm));
  const quotaSlots = sumKnown(quotaRows.map((row) => row.epguSlots));
  const quotaCoverage = ratio(quotaSlots, quotaNorm);
  const quotaCompleteData = quotaRows.every((row) => row.epguNorm !== null && (row.epguNorm <= 0 || row.epguSlots !== null));
  return {
    norm,
    epguSlots,
    coverage,
    quotaNorm,
    quotaSlots,
    quotaCoverage,
    deficit,
    below: quotaRows.filter((row) => row.epguNorm !== null && row.epguNorm > 0 && row.epguSlots !== null && row.epguSlots < row.epguNorm).length,
    complete: quotaCoverage !== null && quotaCoverage >= 100,
    quotaCompleteData,
    missing: quotaRows.filter((row) => row.epguNorm === null || (row.epguNorm > 0 && row.epguSlots === null)).length,
    applicable: quotaRows.filter((row) => row.epguNorm !== null && row.epguNorm > 0).length,
  };
}

const orgMetrics = (org: Organization) => metrics(org.specialties);
const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.belowNorm;
const status = (value: number | null) => value === null ? "Нет данных" : value >= 100 ? "Норма выполнена" : "Ниже норматива";
const heatColor = (value: number | null) => {
  if (value === null) return "#e8eef3";
  const percentDone = Math.min(100, Math.max(0, value));
  const from = [190, 58, 68];
  const to = [33, 130, 87];
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * percentDone / 100));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
};
const riskClass = (count: number) => count === 0 ? styles.riskNone : count === 1 ? styles.riskOne : count === 2 ? styles.riskTwo : styles.riskThree;
const shownOrgName = (org: Organization) => org.name;
const matrixOrgName = (org: Organization) => org.name
  .replace(/^(?:(?:РЕСПУБЛИКИ\s+ТАТАРСТАН|ФГАОУ|ФГБОУ|ФГБУ|ФГКУ|ГАУЗ|ГБУЗ|ГКУЗ|ГАУ|ГБУ|ГКУ|МБУЗ|МУЗ|ГУЗ|ООО|АО|ЧУЗ|АНО|ЗАО|ОАО|НЧОУ|ФКУ|ВО|РТ|РФ)\s+)+/i, "")
  .replace(/^\s*[«"]|[»"]\s*$/g, "")
  .trim();

function OwnershipSwitch({ value, onChange }: { value: Ownership; onChange: (value: Ownership) => void }) {
  return <div className={styles.ownership} role="group" aria-label="Тип медицинской организации">
    <button type="button" className={value === "state" ? styles.ownershipActive : ""} onClick={() => onChange("state")}>Государственные</button>
    <button type="button" className={value === "private" ? styles.ownershipActive : ""} onClick={() => onChange("private")}>Частные</button>
  </div>;
}

export default function Incident38Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [ownership, setOwnership] = useState<Ownership>("state");
  const [selectedOid, setSelectedOid] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixTotalDirection, setMatrixTotalDirection] = useState<"asc" | "desc">("asc");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const visibleOrganizations = useMemo(() => ORGANIZATIONS
    .filter((org) => ownership === "private" ? isPrivateOrganization(org) : !isPrivateOrganization(org)), [ownership]);
  const organizationRows = useMemo(() => visibleOrganizations
    .map((org) => ({ org, ...orgMetrics(org) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);
  const selectedOrg = organizationSearch.trim()
    ? null
    : visibleOrganizations.find((org) => org.oid === selectedOid) ?? visibleOrganizations[0] ?? null;
  const regional = useMemo(() => metrics(visibleOrganizations.flatMap((org) => org.specialties)), [visibleOrganizations]);
  const specRows = useMemo(() => SPECIALTIES.map((specialty) => {
    const cells = visibleOrganizations.flatMap((org) => org.specialties.filter((row) => row.code === specialty.code));
    const applicable = cells.filter((row) => row.norm === null || row.norm > 0);
    const norm = sumKnown(applicable.map((row) => row.norm));
    const slots = sumKnown(applicable.map((row) => row.epguSlots));
    const coverage = ratio(slots, norm);
    const quotaRows = applicable.filter((row) => row.epguNorm === null || row.epguNorm > 0);
    const quotaNorm = sumKnown(quotaRows.map((row) => row.epguNorm));
    const quotaSlots = sumKnown(quotaRows.map((row) => row.epguSlots));
    const quotaCoverage = ratio(quotaSlots, quotaNorm);
    const complete = applicable.every((row) => row.norm !== null && (row.norm <= 0 || row.epguSlots !== null));
    const deficit = complete ? sumKnown(applicable.map((row) => shortfall(row.epguSlots, row.norm))) : null;
    return {
      ...specialty,
      norm,
      slots,
      coverage,
      quotaNorm,
      quotaSlots,
      quotaCoverage,
      deficit,
      organizations: applicable.filter((row) => row.norm !== null && row.norm > 0).length,
      below: applicable.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots !== null && row.epguSlots < row.norm).length,
      missing: applicable.filter((row) => row.norm === null || (row.norm > 0 && row.epguSlots === null)).length,
    };
  }).sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);

  const organizationSuggestions = organizationSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(organizationSearch.toLocaleLowerCase("ru"))).slice(0, 8)
    : [];
  const matrixSuggestions = matrixSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => org.name.toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru"))).slice(0, 6)
    : [];
  const matrixRows = organizationRows
    .filter(({ org }) => shownOrgName(org).toLocaleLowerCase("ru").includes(matrixSearch.toLocaleLowerCase("ru")))
    .sort((a, b) => {
      if (a.coverage === null) return b.coverage === null ? 0 : 1;
      if (b.coverage === null) return -1;
      return matrixTotalDirection === "asc" ? a.coverage - b.coverage : b.coverage - a.coverage;
    });
  const selectedSpecialties = selectedOrg
    ? selectedOrg.specialties.map((row) => ({ ...row, coverage: ratio(row.epguSlots, row.norm), deficit: shortfall(row.epguSlots, row.norm) }))
      .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY))
    : [];
  const benchmarkDataset = selectedOrg
    ? DATA.find((dataset) => dataset.orgs.some((org) => org.oid === selectedOrg.oid))
    : undefined;
  const benchmarkBySpecialty = new Map(SPECIALTIES.map((specialty) => {
    const values = (benchmarkDataset?.orgs ?? [])
      .map((org) => org.specialties.find((row) => row.code === specialty.code))
      .filter((row): row is Specialty => Boolean(row && row.norm !== null && row.norm > 0 && row.epguSlots !== null))
      .map((row) => row.epguSlots! / row.norm! * 100);
    return [specialty.code, { median: median(values), count: values.length }] as const;
  }));
  const completeCount = organizationRows.filter((row) => row.complete).length;
  const belowCount = organizationRows.filter((row) => row.quotaCoverage !== null && row.quotaCoverage < 100).length;
  const missingCount = organizationRows.filter((row) => !row.quotaCompleteData || row.quotaCoverage === null || row.missing > 0).length;
  const currentIndex = selectedOrg ? organizationRows.findIndex((row) => row.org.oid === selectedOrg.oid) : -1;

  function openOrg(oid: string) {
    setSelectedOid(oid);
    setOrganizationSearch("");
    setTab("organization");
  }

  function changeOwnership(value: Ownership) {
    setOwnership(value);
    setSelectedOid("");
    setOrganizationSearch("");
    setMatrixSearch("");
  }

  function toggleTotalSort() { setMatrixTotalDirection((direction) => direction === "asc" ? "desc" : "asc"); }

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>РАЗДЕЛ И38 · ФОРМА И-38.9</p><h1>Слоты ЕПГУ по нормативам</h1>
        <p className={styles.subtitle}>Свободные слоты на ближайшие 14 дней · {ownership === "state" ? "государственные" : "частные"} медицинские организации</p>
        <p className={styles.sourceDates}>Даты выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" · ")} · актуальность ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</p>
      </div>
      <div className={styles.heroResult}><span>И‑38.9 · слоты ЕПГУ от общего норматива</span><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><small>Для плановой оценки смотрите выполнение квоты ЕПГУ ниже</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button type="button" className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.kpis}>
        <article className={styles.kpi}><strong className={tone(regional.coverage)}>{percent(regional.coverage)}</strong><span>И‑38.9: слоты ЕПГУ от общего норматива</span><small>{format(regional.epguSlots)} слотов ЕПГУ ÷ {format(regional.norm)} слотов по общему нормативу</small></article>
        <article className={styles.kpi}><strong className={tone(regional.quotaCoverage)}>{percent(regional.quotaCoverage)}</strong><span>Выполнение квоты ЕПГУ</span><small>{format(regional.quotaSlots)} слотов ЕПГУ ÷ {format(regional.quotaNorm)} по норме ЕПГУ · план 100%</small></article>
        <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Суммарно не хватает слотов ЕПГУ</span><small>Сумма нехватки по каждой МО и специальности</small></article>
        <article className={styles.kpi}><strong className={styles.good}>{completeCount}</strong><span>МО выполнили квоту ЕПГУ</span><small>Слотов ЕПГУ не меньше нормы для ЕПГУ</small></article>
        <article className={styles.kpi}><strong className={styles.belowNorm}>{belowCount}</strong><span>МО ниже квоты ЕПГУ</span><small>Слотов ЕПГУ меньше нормы для ЕПГУ</small></article>
        <article className={styles.kpi}><strong className={styles.neutral}>{missingCount}</strong><span>МО с неполными данными</span><small>Расчёт может быть неполным</small></article>
      </div>
      <div className={styles.note}><b>Почему два процента:</b> И‑38.9 = слоты ЕПГУ ÷ «Норматив ВСЕГО» — показывает долю общего норматива, открытую на Госуслугах; его планового процента в выгрузке нет. Выполнение квоты ЕПГУ = слоты ЕПГУ ÷ «Норма для ЕПГУ»; план — 100% своей квоты. Обе нормы на 14 дней рассчитываются в исходной форме по нормативам приложения № 4 с учётом нерабочих дней. Выше 100% означает превышение соответствующей нормы; «—» — данных недостаточно или норма не задана.</div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Два показателя по специальностям</h2><p className={styles.chartNote}><span><i className={styles.legendGeneral} />И‑38.9: от общего норматива</span><span><i className={styles.legendQuota} />Квота ЕПГУ: от нормы ЕПГУ (план 100%)</span></p>
          <div className={styles.barList}>{specRows.map((row) => <div className={styles.dualBarRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.dualBars}><div className={styles.track}><i style={{ width: `${Math.min(100, Math.max(0, row.coverage ?? 0))}%`, background: heatColor(row.coverage) }} /></div><div className={styles.track}><i className={styles.quotaFill} style={{ width: `${Math.min(100, Math.max(0, row.quotaCoverage ?? 0))}%` }} /></div></div><b className={tone(row.coverage)}>{percent(row.coverage)}<small>{percent(row.quotaCoverage)}</small></b></div>)}</div>
        </section>
        <section className={styles.card}><h2>Нехватка слотов по специальностям <small>слотов до общего норматива</small></h2>
          <div className={styles.barList}>{[...specRows].sort((a, b) => (b.deficit ?? -1) - (a.deficit ?? -1)).map((row) => <div className={styles.barRow} key={row.code}><span title={row.name}>{row.name}</span><div className={styles.track}><i className={styles.deficitFill} style={{ width: `${Math.min(100, Math.max(0, (row.deficit ?? 0) / Math.max(1, ...specRows.map((item) => item.deficit ?? 0)) * 100))}%` }} /></div><b>{format(row.deficit)}</b></div>)}</div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>Матрица показывает выполнение нормы по каждой специальности. «Не хватает» — сумма нехватки по специальностям, избыток в одной не уменьшает нехватку в другой. Нажмите «Итого», чтобы изменить порядок сортировки.</p></div>
          <div className={styles.matrixControls}>
            <OwnershipSwitch value={ownership} onChange={changeOwnership} />
            <label className={styles.matrixSearch}>Поиск по МО<div className={styles.suggestionBox}><input value={matrixSearch} onChange={(event) => setMatrixSearch(event.target.value)} placeholder="Начните вводить название" autoComplete="off" />
              {matrixSuggestions.length > 0 && <div className={styles.suggestions}>{matrixSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => openOrg(org.oid)}><strong>{matrixOrgName(org)}</strong><span>{org.city}</span></button>)}</div>}
            </div></label>
          </div>
        </div>
        <div className={styles.matrixScroll}><table className={styles.heat}><thead><tr>
          <th className={styles.stickyName}>Медицинская организация</th>
          <th className={styles.shortfallHead}>Не хватает,<br />слотов</th>
          {SPECIALTIES.map((specialty) => <th className={styles.rot} key={specialty.code} title={specialty.name}><span>{specialty.name}</span></th>)}
          <th className={`${styles.rot} ${styles.totalHead}`}><button type="button" onClick={toggleTotalSort} aria-label={`Сортировать по итогу ${matrixTotalDirection === "asc" ? "по убыванию" : "по возрастанию"}`} title="Нажмите, чтобы изменить порядок сортировки">Итого {matrixTotalDirection === "asc" ? "↑" : "↓"}</button></th>
        </tr></thead><tbody>
          {matrixRows.map((row) => <tr key={row.org.oid}>
            <th className={styles.stickyName} onClick={() => openOrg(row.org.oid)} title={`${matrixOrgName(row.org)} · ${row.org.city}`}>
              <span className={styles.matrixName}>{matrixOrgName(row.org)}</span><small className={styles.matrixCity}>{row.org.city}</small>
            </th>
            <td className={styles.shortfallCell} title="Сумма нехватки по каждой специальности; избыток в другой специальности её не уменьшает" onClick={() => openOrg(row.org.oid)}>{format(row.deficit)}</td>
            {SPECIALTIES.map((specialty) => {
              const cell = row.org.specialties.find((item) => item.code === specialty.code);
              const value = cell ? ratio(cell.epguSlots, cell.norm) : null;
              const text = !cell || cell.norm === null ? "—" : cell.norm <= 0 ? "Н" : value === null ? "—" : `${Math.round(value)}`;
              const title = !cell ? "Нет строки по специальности" : cell.norm === null ? "Нет норматива в данных" : cell.norm <= 0 ? "Норматив не задан" : `${specialty.name}: ${percent(value)} · ЕПГУ ${format(cell.epguSlots)} из общего норматива ${format(cell.norm)}`;
              return <td key={specialty.code} title={title} onClick={() => { setSelectedOid(row.org.oid); setSelectedSpecialty(specialty.code); setTab("organization"); }} style={{ background: text === "Н" ? "#e8eef3" : heatColor(value), color: text === "Н" ? "#657d8f" : "#fff" }}>{text}</td>;
            })}
            <td className={styles.totalCell} title={`Итого: ${percent(row.coverage)} · ${format(row.epguSlots)} из ${format(row.norm)}`} onClick={() => openOrg(row.org.oid)} style={{ background: heatColor(row.coverage), color: "#fff" }}>{row.coverage === null ? "—" : Math.round(row.coverage)}</td>
          </tr>)}
        </tbody></table></div>
        {matrixRows.length === 0 && <p className={styles.empty}>МО по так��му названию не найдены.</p>}
      </section>
    </main>}

    {tab === "organization" && <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.orgPicker}>
          <OwnershipSwitch value={ownership} onChange={changeOwnership} />
          <label>Поиск медицинской организации<div className={styles.suggestionBox}><input value={organizationSearch || selectedOrg?.name || ""} onChange={(event) => { setOrganizationSearch(event.target.value); setSelectedOid(""); }} placeholder="Начните вводить название" autoComplete="off" />
            {organizationSuggestions.length > 0 && <div className={styles.suggestions}>{organizationSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => { setSelectedOid(org.oid); setOrganizationSearch(""); }}><strong>{org.name}</strong><span>{org.city}</span></button>)}</div>}
          </div></label>
          <span className={styles.position}>{currentIndex + 1} из {organizationRows.length} · сортировка по выполнению</span>
        </div>
      </section>
      {selectedOrg && <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>Свободные слоты на 14 дней. И‑38.9 сравнивает слоты ЕПГУ с общим нормативом; статус показывает выполнение квоты ЕПГУ.</p></div><span className={`${styles.status} ${orgMetrics(selectedOrg).complete ? styles.statusComplete : !orgMetrics(selectedOrg).quotaCompleteData ? styles.statusMissing : styles.statusBelow}`}>{status(orgMetrics(selectedOrg).quotaCoverage)}</span></div>
        <div className={styles.orgKpis}>
          <article><strong className={tone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>И‑38.9: слоты ЕПГУ от общего норматива</span><small>{format(orgMetrics(selectedOrg).epguSlots)} из {format(orgMetrics(selectedOrg).norm)}</small></article>
          <article><strong className={tone(orgMetrics(selectedOrg).quotaCoverage)}>{percent(orgMetrics(selectedOrg).quotaCoverage)}</strong><span>Выполнение квоты ЕПГУ · план 100%</span><small>{format(orgMetrics(selectedOrg).quotaSlots)} из {format(orgMetrics(selectedOrg).quotaNorm)}</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает слотов до норматива</span><small>сумма по специальностям МО</small></article>
          <article><strong className={riskClass(orgMetrics(selectedOrg).below)}>{orgMetrics(selectedOrg).below} из {orgMetrics(selectedOrg).applicable}</strong><span>Специальностей ниже квоты ЕПГУ</span><small>норма для ЕПГУ больше нуля</small></article>
          <article><strong className={styles.neutral}>{orgMetrics(selectedOrg).missing}</strong><span>Специальностей без полных данных</span><small>нет всех значений для расчёта</small></article>
        </div>
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>И‑38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО». Выполнение квоты = «Слотов для ЕПГУ» ÷ «Норма для ЕПГУ»; ориентир — 100%. «Всего слотов» — фактически открытые слоты всех каналов.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(event) => setSelectedSpecialty(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((specialty) => <option key={specialty.code} value={specialty.code}>{specialty.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Всего слотов</th><th>Норма для ЕПГУ</th><th>Слотов для ЕПГУ</th><th>И‑38.9, % общего норматива</th><th>Квота ЕПГУ выполнена, %</th><th>Не хватает до общего норматива</th></tr></thead><tbody>
          {selectedSpecialties.filter((row) => !selectedSpecialty || row.code === selectedSpecialty).map((row) => <tr key={row.code}><td className={styles.orgName}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.slots)}</td><td>{format(row.epguNorm)}</td><td>{format(row.epguSlots)}</td><td className={`${styles.metricCell} ${tone(row.coverage)}`}>{percent(row.coverage)}</td><td className={`${styles.metricCell} ${tone(ratio(row.epguSlots, row.epguNorm))}`}>{percent(ratio(row.epguSlots, row.epguNorm))}</td><td>{format(row.deficit)}</td></tr>)}
        </tbody></table></div>
        <section className={styles.card}>
          <div className={styles.sectionHead}><div><h2>Организация относительно выборки</h2><p>Медиана доли слотов ЕПГУ от общего норматива среди МО того же набора выгрузки. Выборка: {benchmarkDataset?.orgCount ?? 0} МО · срез {benchmarkDataset?.reportDate ?? "—"}. Отсутствующие значения исключены; нулевые значения учтены.</p></div></div>
          <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>МО, %</th><th>Медиана выборки, %</th><th>Отклонение, п.п.</th><th>МО в выборке</th></tr></thead><tbody>
            {selectedSpecialties.filter((row) => !selectedSpecialty || row.code === selectedSpecialty).map((row) => {
              const benchmark = benchmarkBySpecialty.get(row.code);
              const difference = row.coverage !== null && benchmark?.median !== null && benchmark?.median !== undefined
                ? row.coverage - benchmark.median
                : null;
              return <tr key={row.code}><td className={styles.orgName}>{row.name}</td><td className={styles.metricCell}>{percent(row.coverage)}</td><td>{percent(benchmark?.median ?? null)}</td><td className={difference === null ? styles.neutral : difference >= 0 ? styles.good : styles.belowNorm}>{difference === null ? "—" : <>{difference > 0 ? "+" : ""}{numberFormat.format(difference)}</>}</td><td>{benchmark?.count ?? 0}</td></tr>;
            })}
          </tbody></table></div>
        </section>
      </section>}
    </main>}

    <footer className={styles.footer}>Источник: форма И‑38.9 и её лист «нормативы». «Норматив ВСЕГО» — рассчитанный по приложению № 4 общий норматив слотов на 14 дней; «Норма для ЕПГУ» — его конкурентная часть для записи через Госуслуги. Исходный процент формы: слоты ЕПГУ ÷ общий норматив. Дополнительный контроль квоты: слоты ЕПГУ ÷ норма ЕПГУ; план — 100%. Выгрузки объединены в один перечень МО; даты срезов указаны в шапке. По правилу реорганизации Альметьевска с 01.10.2026 из текущего отчёта исключены строки прежних МО; головная Альметьевская ЦРБ сохранена. Отсутствие данных не заменяется нулём. Фильтр «Государственные» включает организации с подтверждённым участием Республики Татарстан; распределение по типу МО основано на организационно-правовой форме.</footer>
  </div>;
}
