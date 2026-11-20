"use client";

import { Fragment, useMemo, useState } from "react";
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
const PLAN_PERCENT = 70;
const PLAN_RATIO = PLAN_PERCENT / 100;
const planShortfall = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : Math.max(0, Math.ceil(norm * PLAN_RATIO - slots - 1e-9));
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
// The three AO dental organizations in these exports have documented Republic of Tatarstan participation.
// Keep them in the public/state-participation view; classify private entities by their legal-form prefixes.
const isPrivateOrganization = (org: Organization) => /^(ООО|ЧУЗ|ИП|АНО|ЗАО|ОАО|НЧОУ)\s/i.test(org.name.trim());
function metrics(rows: Specialty[]) {
  // Match the source form: include every EPGU slot, even where the overall norm is zero.
  const norm = sumKnown(rows.map((row) => row.norm));
  const epguSlots = sumKnown(rows.map((row) => row.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const complete = rows.every((row) => row.norm !== null && row.epguSlots !== null);
  const deficit = complete ? planShortfall(epguSlots, norm) : null;
  const targetSlots = norm === null ? null : Math.ceil(norm * PLAN_RATIO);
  return {
    norm,
    epguSlots,
    coverage,
    deficit,
    targetSlots,
    complete,
    meetsPlan: coverage !== null && coverage >= PLAN_PERCENT,
    missing: rows.filter((row) => row.norm === null || row.epguSlots === null).length,
  };
}

const orgMetrics = (org: Organization) => metrics(org.specialties);
const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.belowNorm;
const planTone = (value: number | null) => value === null ? styles.neutral : value >= PLAN_PERCENT ? styles.good : styles.belowNorm;
const specialtyBand = (value: number | null) => value === null ? styles.neutral : value >= 75 ? styles.specialtyGreen : value >= 50 ? styles.specialtyYellow : value >= 25 ? styles.specialtyOrange : styles.specialtyRed;
const status = (value: number | null) => value === null ? "Нет данных" : value >= PLAN_PERCENT ? "План 70% выполнен" : "Ниже плана 70%";
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
  const [expandedMatrixOid, setExpandedMatrixOid] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixSort, setMatrixSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "coverage", direction: "asc" });
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const visibleOrganizations = useMemo(() => ORGANIZATIONS
    .filter((org) => ownership === "private" ? isPrivateOrganization(org) : !isPrivateOrganization(org)), [ownership]);
  const organizationRows = useMemo(() => visibleOrganizations
    .map((org) => ({ org, ...orgMetrics(org) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);
  const selectedOrg = organizationSearch.trim()
    ? null
    : visibleOrganizations.find((org) => org.oid === selectedOid) ?? visibleOrganizations[0] ?? null;
  const regional = useMemo(() => {
    const totals = metrics(visibleOrganizations.flatMap((org) => org.specialties));
    return { ...totals, deficit: sumKnown(visibleOrganizations.map((org) => orgMetrics(org).deficit)) };
  }, [visibleOrganizations]);
  const specRows = useMemo(() => SPECIALTIES.map((specialty) => {
    const cells = visibleOrganizations.flatMap((org) => org.specialties.filter((row) => row.code === specialty.code));
    const norm = sumKnown(cells.map((row) => row.norm));
    const slots = sumKnown(cells.map((row) => row.epguSlots));
    const coverage = ratio(slots, norm);
    return {
      ...specialty,
      norm,
      slots,
      coverage,
      organizations: cells.filter((row) => row.norm !== null && row.norm > 0).length,
      missing: cells.filter((row) => row.norm === null || row.epguSlots === null).length,
      zeroSlotsOrganizations: visibleOrganizations.filter((org) => {
        const row = org.specialties.find((item) => item.code === specialty.code);
        return row?.norm !== null && row?.norm !== undefined && row.norm > 0 && row.epguSlots === 0;
      }).length,
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
      const valueFor = (row: typeof a): string | number | null => {
        if (matrixSort.key === "name") return matrixOrgName(row.org).toLocaleLowerCase("ru");
        if (matrixSort.key === "deficit") return row.deficit;
        if (matrixSort.key === "coverage") return row.coverage;
        if (matrixSort.key === "attainment") return row.coverage === null ? null : row.coverage / PLAN_PERCENT * 100;
        if (matrixSort.key === "zeroSpecialties") return row.org.specialties.filter((item) => item.norm !== null && item.norm > 0 && item.epguSlots === 0).length;
        const code = matrixSort.key.startsWith("specialty:") ? matrixSort.key.slice("specialty:".length) : "";
        const cell = row.org.specialties.find((item) => item.code === code);
        return cell ? ratio(cell.epguSlots, cell.norm) : null;
      };
      const left = valueFor(a);
      const right = valueFor(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const comparison = typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right, "ru")
        : Number(left) - Number(right);
      return matrixSort.direction === "asc" ? comparison : -comparison;
    });
  const selectedSpecialties = selectedOrg
    ? selectedOrg.specialties.map((row) => ({ ...row, coverage: ratio(row.epguSlots, row.norm) }))
      .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY))
    : [];
  const benchmarkDataset = selectedOrg
    ? DATA.find((dataset) => dataset.orgs.some((org) => org.oid === selectedOrg.oid))
    : undefined;
  const benchmarkOrganizations = benchmarkDataset
    ? ORGANIZATIONS.filter((org) => benchmarkDataset.orgs.some((candidate) => candidate.oid === org.oid))
    : [];
  const benchmarkBySpecialty = new Map(SPECIALTIES.map((specialty) => {
    const values = benchmarkOrganizations
      .map((org) => org.specialties.find((row) => row.code === specialty.code))
      .filter((row): row is Specialty => Boolean(row && row.norm !== null && row.norm > 0 && row.epguSlots !== null))
      .map((row) => row.epguSlots! / row.norm! * 100);
    return [specialty.code, { median: median(values), count: values.length }] as const;
  }));
  const displaySpecialties = selectedSpecialties.filter((row) => !selectedSpecialty || row.code === selectedSpecialty);
  const comparisonRows = displaySpecialties.map((row) => {
    const benchmark = benchmarkBySpecialty.get(row.code);
    const difference = row.coverage !== null && benchmark?.median !== null && benchmark?.median !== undefined ? row.coverage - benchmark.median : null;
    return { ...row, difference };
  });
  const belowMedianCount = comparisonRows.filter((row) => row.difference !== null && row.difference < 0).length;
  const aboveMedianCount = comparisonRows.filter((row) => row.difference !== null && row.difference >= 0).length;
  const criticalCount = displaySpecialties.filter((row) => row.coverage !== null && row.norm !== null && row.norm > 0 && row.coverage < 25).length;
  const weakestSpecialties = displaySpecialties.filter((row) => row.coverage !== null && row.norm !== null && row.norm > 0).sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0)).slice(0, 3);
  const completeCount = organizationRows.filter((row) => row.complete && row.meetsPlan).length;
  const belowCount = organizationRows.filter((row) => row.complete && !row.meetsPlan).length;
  const missingCount = organizationRows.filter((row) => !row.complete || row.coverage === null).length;
  const completeOrganizations = organizationRows.filter((row) => row.complete && row.coverage !== null);
  const planDistribution = [
    { key: "lt50", label: "Менее 50% плана", min: 0, max: 50, color: "#b83d47" },
    { key: "50to100", label: "50–<100% плана", min: 50, max: 100, color: "#ca7b37" },
    { key: "100to120", label: "100–<120% плана", min: 100, max: 120, color: "#387a5b" },
    { key: "gte120", label: "120% плана и выше", min: 120, max: Number.POSITIVE_INFINITY, color: "#16875c" },
  ].map((band) => {
    const count = completeOrganizations.filter((row) => {
      const achievement = row.coverage! / PLAN_PERCENT * 100;
      return achievement >= band.min && achievement < band.max;
    }).length;
    return { ...band, count, share: completeOrganizations.length ? count / completeOrganizations.length * 100 : 0 };
  });
  const maxPlanDistribution = Math.max(1, ...planDistribution.map((band) => band.count));
  const currentIndex = selectedOrg ? organizationRows.findIndex((row) => row.org.oid === selectedOrg.oid) : -1;

  function openOrg(oid: string) {
    setSelectedOid(oid);
    setSelectedSpecialty("");
    setOrganizationSearch("");
    setTab("organization");
  }

  function changeOwnership(value: Ownership) {
    setOwnership(value);
    setSelectedOid("");
    setOrganizationSearch("");
    setMatrixSearch("");
  }

  function toggleMatrixSort(key: string) {
    setMatrixSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }
  const sortMark = (key: string) => matrixSort.key === key ? (matrixSort.direction === "asc" ? " ↑" : " ↓") : "";

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>РАЗДЕЛ И38 · ФОРМА И-38.9</p><h1>Слоты ЕПГУ по нормативам</h1>
        <p className={styles.subtitle}>Свободные слоты на ближайшие 14 дней · {ownership === "state" ? "государственные" : "частные"} медицинские организации</p>
        <p className={styles.sourceDates}>Даты выгрузок: {DATA.map((dataset) => dataset.reportDate).join(" · ")} · актуальность ФРМР: {DATA.map((dataset) => dataset.frmoDate).join(" · ")}</p>
      </div>
      <div className={styles.heroResult}><span>И‑38.9 · слоты ЕПГУ от общего норматива</span><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><small>План для каждой МО — 70%</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button type="button" className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.overviewGrid}>
        <div className={styles.kpis}>
          <article className={styles.kpi}><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><span>Общий процент И‑38.9</span><small>{format(regional.epguSlots)} слотов ЕПГУ ÷ {format(regional.norm)} «Норматив ВСЕГО»</small></article>
          <article className={styles.kpi}><strong className={styles.good}>{completeCount}</strong><span>МО выполнили план 70%</span><small>И‑38.9 каждой МО не ниже 70%</small></article>
          <article className={styles.kpi}><strong className={styles.belowNorm}>{belowCount}</strong><span>МО ниже плана 70%</span><small>С полными данными</small></article>
          <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Не хватает слотов до плана</span><small>Минимальная нехватка по каждой МО</small></article>
          <article className={styles.kpi}><strong className={styles.neutral}>{missingCount}</strong><span>МО с неполными данными</span><small>Не считаются нулём</small></article>
        </div>
        <article className={styles.maxGroupCard}>
          <span className={styles.maxGroupEyebrow}>РАБОЧАЯ ГРУППА</span>
          <h2>Инцидент 38 в MAX</h2>
          <a className={styles.maxGroupLink} href="https://max.ru/join/_IjdDQBUBT835_Cz_fdY4ELQ8X2u72CuZGndk1cTcq8" target="_blank" rel="noreferrer">Открыть чат <span aria-hidden="true">↗</span></a>
        </article>
      </div>
      <div className={styles.note}><b>Как читать показатель:</b> Реальный процент = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%. План для каждой МО — 70%. Нехватка = max(0, округление вверх(«Норматив ВСЕГО» × 70%) − «Слотов для ЕПГУ»), считается отдельно по каждой МО. Общий процент — сумма слотов ЕПГУ, делённая на сумму общего норматива. В расчёте учитываются все слоты ЕПГУ, в том числе по специальностям с нулевым нормативом. {DATA[0].reportDate === DATA[1].reportDate ? `Обе выгрузки на ${DATA[0].reportDate}.` : `Даты выгрузок: ${DATA.map((dataset) => dataset.reportDate).join(" и ")}.`} «Норма для ЕПГУ» и «Всего слотов» не влияют на этот показатель.</div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Распределение МО по достижению плана</h2><p className={styles.chartNote}>Сколько организаций достигло разных уровней от индивидуального плана 70%. Достижение плана = И‑38.9 МО ÷ 70%. В расчёт включены МО с полными данными: {completeOrganizations.length}.</p>
          <div className={styles.planDistribution}>{planDistribution.map((band) => <div className={styles.planDistributionRow} key={band.key}><span>{band.label}</span><div className={styles.track}><i style={{ width: `${band.count / maxPlanDistribution * 100}%`, background: band.color }} /></div><strong>{band.count}</strong><small>{percent(band.share)}</small></div>)}</div>
          <p className={styles.chartNote}>МО без полных данных: {missingCount}. «100–&lt;120%» означает выполнение плана с превышением до 20%.</p>
        </section>
        <section className={styles.card}><h2>Специальности с наибольшим дефицитом слотов</h2><p className={styles.chartNote}>Показаны специальности с наименьшим общим процентом И‑38.9. «МО без слотов» — организации, где норматив есть, а слотов ЕПГУ нет. План 70% применяется к МО в целом; ранжирование специальностей — диагностическое.</p>
          <div className={styles.deficitSpecialties}>{[...specRows].filter((row) => row.norm !== null && row.norm > 0).slice(0, 5).map((row, index) => <div className={styles.deficitSpecialty} key={row.code}><b>{index + 1}</b><span title={row.name}>{row.name}</span><div className={styles.track}><i style={{ width: `${Math.min(100, Math.max(0, row.coverage ?? 0))}%`, background: heatColor(row.coverage) }} /></div><strong className={styles.neutral}>{percent(row.coverage)}</strong><small>{row.zeroSlotsOrganizations} МО без слотов</small></div>)}</div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>План — 70% общего норматива. «Выполнение плана, %»: 100% означает, что МО достигла этого уровня. «Спец. с 0 слотами» — специальности с положительным нормативом, но без слотов ЕПГУ.</p></div>
          <div className={styles.matrixControls}>
            <OwnershipSwitch value={ownership} onChange={changeOwnership} />
            <label className={styles.matrixSearch}>Поиск по МО<div className={styles.suggestionBox}><input value={matrixSearch} onChange={(event) => setMatrixSearch(event.target.value)} placeholder="Начните вводить название" autoComplete="off" />
              {matrixSuggestions.length > 0 && <div className={styles.suggestions}>{matrixSuggestions.map((org) => <button type="button" key={org.oid} onClick={() => openOrg(org.oid)}><strong>{matrixOrgName(org)}</strong><span>{org.city}</span></button>)}</div>}
            </div></label>
          </div>
        </div>
        <div className={styles.matrixScroll}><table className={styles.heat}><colgroup><col className={styles.orgCol} /><col className={styles.shortfallCol} /><col className={styles.attainmentCol} />{SPECIALTIES.map((specialty) => <col className={styles.specialtyCol} key={specialty.code} />)}<col className={styles.totalCol} /></colgroup><thead><tr>
          <th className={styles.stickyName}><button type="button" className={styles.sortButton} onClick={() => toggleMatrixSort("name")}>Медицинская организация{sortMark("name")}</button></th>
          <th className={styles.shortfallHead}><button type="button" className={styles.sortButton} onClick={() => toggleMatrixSort("deficit")}>Не хватает<br />до плана{sortMark("deficit")}</button></th>
          <th className={styles.attainmentHead}><button type="button" className={styles.sortButton} onClick={() => toggleMatrixSort("attainment")} title="100% означает, что МО достигла плана 70%">Выполнение<br />плана, %{sortMark("attainment")}</button></th>
          {SPECIALTIES.map((specialty) => <th className={styles.rot} key={specialty.code} title={specialty.name}><button type="button" className={styles.specialtySort} onClick={() => toggleMatrixSort(`specialty:${specialty.code}`)}>{specialty.name.startsWith("ВОП") ? "ВОП" : specialty.name}{sortMark(`specialty:${specialty.code}`)}</button></th>)}
          <th className={styles.totalHead}><button type="button" className={styles.sortButton} onClick={() => toggleMatrixSort("zeroSpecialties")} title="Количество специальностей с положительным нормативом и нулём слотов ЕПГУ">Спец. с 0<br />слотами{sortMark("zeroSpecialties")}</button></th>
        </tr></thead><tbody>
          {matrixRows.map((row) => {
            const zeroSpecialtyCount = row.org.specialties.filter((item) => item.norm !== null && item.norm > 0 && item.epguSlots === 0).length;
            return <Fragment key={row.org.oid}><tr>
            <th className={styles.stickyName} onClick={() => openOrg(row.org.oid)} title={`${matrixOrgName(row.org)} · ${row.org.city}`}>
              <span className={styles.matrixName}>{matrixOrgName(row.org)}</span><small className={styles.matrixCity}>{row.org.city}</small>
              <button type="button" className={styles.mobileExpand} aria-expanded={expandedMatrixOid === row.org.oid} onClick={(event) => { event.stopPropagation(); setExpandedMatrixOid(expandedMatrixOid === row.org.oid ? "" : row.org.oid); }}>Специальности {expandedMatrixOid === row.org.oid ? "▲" : "▼"}</button>
            </th>
            <td className={styles.shortfallCell} title={`Минимум слотов до плана 70%: ${format(row.deficit)}`} onClick={() => openOrg(row.org.oid)}>{format(row.deficit)}</td>
            <td className={styles.attainmentCell} title={`При фактическом показателе ${percent(row.coverage)} план 70% составляет 100% выполнения`}>{row.coverage === null ? "—" : percent(row.coverage / PLAN_PERCENT * 100)}</td>
            {SPECIALTIES.map((specialty) => {
              const cell = row.org.specialties.find((item) => item.code === specialty.code);
              const value = cell ? ratio(cell.epguSlots, cell.norm) : null;
              const text = !cell || cell.norm === null ? "—" : cell.norm <= 0 ? "Н" : value === null ? "—" : `${Math.round(value)}`;
              const title = !cell ? "Нет строки по специальности" : cell.norm === null ? "Нет норматива в данных" : cell.norm <= 0 ? "Норматив не задан" : `${specialty.name}: ${percent(value)} · ЕПГУ ${format(cell.epguSlots)} из общего норматива ${format(cell.norm)}`;
              return <td className={styles.specialtyCell} key={specialty.code} title={title} onClick={() => { setSelectedOid(row.org.oid); setSelectedSpecialty(specialty.code); setTab("organization"); }} style={{ background: text === "Н" ? "#e8eef3" : heatColor(value), color: text === "Н" ? "#657d8f" : "#fff" }}>{text}</td>;
            })}
            <td className={styles.totalCell} title="Число специальностей, где норматив больше нуля, а слотов ЕПГУ нет" style={{ background: zeroSpecialtyCount > 0 ? "#b83d47" : "#218257", color: "#fff" }}>{zeroSpecialtyCount}</td>
          </tr>
          {expandedMatrixOid === row.org.oid && <tr className={styles.mobileDetailsRow}><td colSpan={18}><div className={styles.mobileSpecialties}>
            {SPECIALTIES.map((specialty) => {
              const cell = row.org.specialties.find((item) => item.code === specialty.code);
              const value = cell ? ratio(cell.epguSlots, cell.norm) : null;
              const description = !cell || cell.norm === null ? "Нет данных" : cell.norm <= 0 ? "Норматив не задан" : value === null ? "Нет данных по слотам" : `${percent(value)} · ${format(cell.epguSlots)} из ${format(cell.norm)} слотов`;
              return <div className={styles.mobileSpecialty} key={specialty.code}><span>{specialty.name}</span><strong>{description}</strong></div>;
            })}
          </div></td></tr>}</Fragment>;
          })}
        </tbody></table></div>
        <p className={styles.matrixMethod}>Расчёт: процент слотов ЕПГУ от общего норматива ÷ 70% × 100%. Например, 70% общего норматива — это 100% выполнения плана. «Спец. с 0 слотами» учитывает только специальности с заданным положительным нормативом.</p><p className={styles.matrixMobileHint}>Нажмите «Специальности» в строке МО, чтобы увидеть разбивку по 14 специальностям.</p>
        {matrixRows.length === 0 && <p className={styles.empty}>МО по такому названию не найдены.</p>}
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
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>И‑38.9 = слоты ЕПГУ ÷ «Норматив ВСЕГО» × 100%. План для МО — 70%; статус показывает его выполнение.</p></div><span className={`${styles.status} ${!orgMetrics(selectedOrg).complete ? styles.statusMissing : orgMetrics(selectedOrg).meetsPlan ? styles.statusComplete : styles.statusBelow}`}>{status(orgMetrics(selectedOrg).coverage)}</span></div>
        <div className={styles.orgKpis}>
          <article><strong className={planTone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>И‑38.9 · план 70%</span><small>{format(orgMetrics(selectedOrg).epguSlots)} слотов ЕПГУ из {format(orgMetrics(selectedOrg).norm)} по общему нормативу</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).targetSlots)}</strong><span>Слотов нужно для плана</span><small>70% общего норматива, округление вверх</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает до плана</span><small>минимальное число дополнительных слотов ЕПГУ</small></article>
        </div>
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>Значения по специальностям справочные: план 70% применяется к общему показателю МО. Медиана сравнивает МО с другими организациями того же набора выгрузки.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(event) => setSelectedSpecialty(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((specialty) => <option key={specialty.code} value={specialty.code}>{specialty.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Слотов для ЕПГУ</th><th>И‑38.9, %</th><th>Медиана выборки, %</th><th>Отклонение, п.п.</th><th>МО в выборке</th></tr></thead><tbody>
          {displaySpecialties.map((row) => {
            const benchmark = benchmarkBySpecialty.get(row.code);
            const difference = row.coverage !== null && benchmark?.median !== null && benchmark?.median !== undefined ? row.coverage - benchmark.median : null;
            return <tr key={row.code}><td className={styles.orgName}>{row.name}</td><td>{format(row.norm)}</td><td>{format(row.epguSlots)}</td><td className={`${styles.metricCell} ${specialtyBand(row.coverage)}`}>{percent(row.coverage)}</td><td>{percent(benchmark?.median ?? null)}</td><td className={difference === null ? styles.neutral : difference >= 0 ? styles.good : styles.belowNorm}>{difference === null ? "—" : <>{difference > 0 ? "+" : ""}{numberFormat.format(difference)}</>}</td><td>{benchmark?.count ?? 0}</td></tr>;
          })}
        </tbody></table></div>
        <section className={styles.orgInsights}>
          <article><h3>Организация относительно выборки</h3><p>По выбранным специальностям ниже медианы: <b>{belowMedianCount}</b>; на уровне или выше: <b>{aboveMedianCount}</b>.</p></article>
          <article><h3>Управленческий вывод</h3><p>Специальностей с уровнем ниже 25%: <b>{criticalCount}</b>. Самые низкие значения: {weakestSpecialties.length ? weakestSpecialties.map((row) => `${row.name} — ${percent(row.coverage)}`).join("; ") : "нет данных"}.</p></article>
        </section>
        <div className={styles.specialtyLegend}><span><i className={styles.specialtyGreen} />≥75% — высокий уровень</span><span><i className={styles.specialtyYellow} />50–74% — требует внимания</span><span><i className={styles.specialtyOrange} />25–49% — зона риска</span><span><i className={styles.specialtyRed} />&lt;25% — критично</span><span>Цветовой ориентир для специальности; план 70% оценивается по МО в целом.</span></div>
        <p className={styles.chartNote}>Медиана рассчитана по МО той же выгрузки: {benchmarkOrganizations.length} организаций · срез {benchmarkDataset?.reportDate ?? "—"}. В выборку по специальности входят МО с положительным общим нормативом; нулевые значения слотов учитываются.</p>
      </section>}
    </main>}

    <footer className={styles.footer}>Источник: форма И‑38.9, лист «нормативы». Реальный процент И‑38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%; план каждой МО — 70%. Нехватка рассчитывается по каждой МО как минимальное целое число дополнительных слотов до 70% общего норматива. «Норма для ЕПГУ» и «Всего слотов» в оценке не используются. Итог по региону — отношение суммы слотов к сумме общего норматива. Даты срезов: {DATA.map((dataset) => dataset.reportDate).join(" · ")}. По правилу реорганизации Альметьевска из текущего отчёта исключены прежние МО, головная организация сохранена. Отсутствие данных не заменяется нулём; государственные/частные организации разделены по организационно-правовой форме.</footer>
  </div>;
}
