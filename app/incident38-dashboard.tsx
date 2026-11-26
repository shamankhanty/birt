"use client";

import { Fragment, useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import historyRaw from "./incident38-history.json";
import frmrRaw from "./frmr-all-specialties.json";
import frmoLinkageRaw from "./frmo-linkage-data.json";
import { getFrmrSpecialtyIssues, getFrmoOrganizationFindings } from "../lib/incident38-frmr-diagnostic.js";
import { balancedSpecialties } from "../lib/incident38-balanced-specialties.js";
import { matchesMoSearch } from "../lib/incident38-mo-search.js";
import reorganizationRaw from "../config/mo-reorganizations.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; specialties: Specialty[] };
type Dataset = { source: string; reportDate: string; asOf: string; frmoDate: string; forwardDays: number; orgCount: number; specialties: Array<{ code: string; name: string }>; orgs: Organization[] };
type Tab = "overview" | "organization";
type Ownership = "state" | "private";

const DATA: Dataset[] = [cityRaw as Dataset, districtRaw as Dataset];
const FRMR_OID_PREFIX = "1.2.643.5.1.13.13.12.2.16.";
const FRMR_MO_IDS = new Set(frmrRaw.summary.rows.map(row => row[0]));
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
type HistoricalOrg = { oid: string; name: string; norm: number | null; epguSlots: number | null };
type HistoricalSnapshot = { scope: string; reportDate: string; frmoDate: string; source: string; orgs: HistoricalOrg[] };
const HISTORY = (historyRaw as { snapshots: HistoricalSnapshot[] }).snapshots;
const SPECIALTIES = [...new Map(DATA.flatMap((dataset) => dataset.specialties).map((specialty) => [specialty.code, specialty])).values()];
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const format = (value: SlotValue) => value === null || value === undefined ? "—" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)}%`;
const sumKnown = (values: SlotValue[]) => values.some((value) => value === null || value === undefined) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const ratio = (slots: SlotValue, norm: SlotValue) => slots === null || norm === null || norm <= 0 ? null : slots / norm * 100;
const PLAN_PERCENT = 60;
const GOAL_PERCENT = 70;
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

/** Read-only reuse of the same source, ownership rules and formula as И-38.9. */
export function getVitrinaIncident38(includePrivate: boolean) {
  const orgs = ORGANIZATIONS.filter(org => includePrivate || !isPrivateOrganization(org));
  const dates = [...new Set(DATA.map(dataset => dataset.reportDate))];
  const horizons = [...new Set(DATA.map(dataset => dataset.forwardDays))];
  const unique = new Set(orgs.map(org => org.oid)).size === orgs.length;
  const comparable = dates.length === 1 && horizons.length === 1 && unique;
  const total = comparable ? metrics(orgs.flatMap(org => org.specialties)) : null;
  const specialties = SPECIALTIES.map(specialty => {
    const cells = orgs.map(org => org.specialties.find(row => row.code === specialty.code));
    const complete = comparable && cells.every((row): row is Specialty => Boolean(row));
    const aggregate = complete ? metrics(cells.filter((row): row is Specialty => Boolean(row))) : null;
    return { ...specialty, aggregate };
  }).sort((a,b) => (a.aggregate?.coverage ?? Infinity) - (b.aggregate?.coverage ?? Infinity));
  const gap = (rows: Specialty[]) => rows.some(row => row.norm == null || row.epguSlots == null) ? null : rows.reduce((sum,row) => sum + (row.norm! > 0 ? Math.max(0,Math.ceil(row.norm! * GOAL_PERCENT / 100 - row.epguSlots! - 1e-9)) : 0),0);
  const zero = (rows: Specialty[]) => rows.filter(row=>row.norm != null && row.norm > 0 && row.epguSlots === 0).length;
  const organizations = comparable ? orgs.map(org=>({...org,aggregate:orgMetrics(org),gap:gap(org.specialties),zero:zero(org.specialties)})) : [];
  return { dates, horizons, comparable, orgCount: orgs.length, total, organizations, specialties: specialties.map(s=>({...s,gap:s.aggregate ? gap(orgs.flatMap(org=>org.specialties.filter(row=>row.code===s.code))) : null,zero:s.aggregate ? zero(orgs.flatMap(org=>org.specialties.filter(row=>row.code===s.code))) : null})) };
}

const tone = (value: number | null) => value === null ? styles.neutral : value >= 100 ? styles.good : styles.belowNorm;
const planTone = (value: number | null) => value === null ? styles.neutral : value >= PLAN_PERCENT ? styles.good : styles.belowNorm;
const specialtyBand = (value: number | null) => value === null ? styles.neutral : value >= 75 ? styles.specialtyGreen : value >= 50 ? styles.specialtyYellow : value >= 25 ? styles.specialtyOrange : styles.specialtyRed;
const status = (value: number | null) => value === null ? "Нет данных" : value >= GOAL_PERCENT ? "Цель 70% достигнута" : value >= PLAN_PERCENT ? "План 60% выполнен" : "Ниже плана 60%";
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

export default function Incident38Dashboard({ onOpenFrmrMo }: { onOpenFrmrMo: (oid: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [ownership, setOwnership] = useState<Ownership>("state");
  const [selectedOid, setSelectedOid] = useState("");
  const [expandedMatrixOid, setExpandedMatrixOid] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixSort, setMatrixSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "balanced", direction: "asc" });
  const [selectedSpecialty, setSelectedSpecialty] = useState("");

  const visibleOrganizations = useMemo(() => ORGANIZATIONS
    .filter((org) => ownership === "private" ? isPrivateOrganization(org) : !isPrivateOrganization(org)), [ownership]);
  const organizationRows = useMemo(() => visibleOrganizations
    .map((org) => ({ org, ...orgMetrics(org), balanced: balancedSpecialties(org.specialties) }))
    .sort((a, b) => (a.coverage ?? Number.POSITIVE_INFINITY) - (b.coverage ?? Number.POSITIVE_INFINITY)), [visibleOrganizations]);
  const selectedOrg = organizationSearch.trim()
    ? null
    : visibleOrganizations.find((org) => org.oid === selectedOid) ?? visibleOrganizations[0] ?? null;
  const selectedBalanced = selectedOrg ? balancedSpecialties(selectedOrg.specialties) : null;
  const regional = useMemo(() => {
    const totals = metrics(visibleOrganizations.flatMap((org) => org.specialties));
    return { ...totals, deficit: sumKnown(visibleOrganizations.map((org) => orgMetrics(org).deficit)) };
  }, [visibleOrganizations]);
  const scopeHistory = useMemo(() => DATA.map((dataset, index) => {
    const scope = index === 0 ? "cities" : "districts";
    const prior = HISTORY.filter((snapshot) => snapshot.scope === scope && dateKey(snapshot.reportDate) < dateKey(dataset.reportDate)).sort((a, b) => dateKey(b.reportDate).localeCompare(dateKey(a.reportDate)))[0];
    if (!prior) return null;
    const currentIds = new Set(visibleOrganizations.map((org) => org.oid));
    const current = dataset.orgs.filter((org) => currentIds.has(org.oid));
    const oldByOid = new Map(prior.orgs.map((org) => [org.oid, org]));
    const matched = current.map((org) => ({ org, old: oldByOid.get(org.oid), now: orgMetrics(org) })).filter((row) => row.old && row.old.norm !== null && row.old.epguSlots !== null && row.now.complete && row.now.norm !== null && row.now.epguSlots !== null);
    if (!matched.length) return null;
    const beforeSlots = matched.reduce((sum, row) => sum + row.old!.epguSlots!, 0);
    const beforeNorm = matched.reduce((sum, row) => sum + row.old!.norm!, 0);
    const afterSlots = matched.reduce((sum, row) => sum + row.now.epguSlots!, 0);
    const afterNorm = matched.reduce((sum, row) => sum + row.now.norm!, 0);
    const movers = matched.map((row) => ({ oid: row.org.oid, name: matrixOrgName(row.org), before: ratio(row.old!.epguSlots!, row.old!.norm!), after: row.now.coverage, slotsDelta: row.now.epguSlots! - row.old!.epguSlots! })).filter((row) => row.before !== null && row.after !== null).sort((a, b) => Math.abs((b.after! - b.before!)) - Math.abs((a.after! - a.before!)));
    const bestMovers = movers.filter((row) => row.after! > row.before!).sort((a, b) => (b.after! - b.before!) - (a.after! - a.before!)).slice(0, 5);
    const worstMovers = movers.filter((row) => row.after! < row.before!).sort((a, b) => (a.after! - a.before!) - (b.after! - b.before!)).slice(0, 5);
    const beforePlan = movers.filter((row) => row.before! >= PLAN_PERCENT).length;
    const afterPlan = movers.filter((row) => row.after! >= PLAN_PERCENT).length;
    const beforeGoal = movers.filter((row) => row.before! >= GOAL_PERCENT).length;
    const afterGoal = movers.filter((row) => row.after! >= GOAL_PERCENT).length;
    const planUp = movers.filter((row) => row.before! < PLAN_PERCENT && row.after! >= PLAN_PERCENT).length;
    const planDown = movers.filter((row) => row.before! >= PLAN_PERCENT && row.after! < PLAN_PERCENT).length;
    const goalUp = movers.filter((row) => row.before! < GOAL_PERCENT && row.after! >= GOAL_PERCENT).length;
    const goalDown = movers.filter((row) => row.before! >= GOAL_PERCENT && row.after! < GOAL_PERCENT).length;
    const oldDeficit = matched.reduce((sum, row) => sum + (planShortfall(row.old!.epguSlots!, row.old!.norm!) ?? 0), 0);
    const newDeficit = matched.reduce((sum, row) => sum + (row.now.deficit ?? 0), 0);
    return { scope, label: index === 0 ? "Казань и Набережные Челны" : "Районы", prior, date: dataset.reportDate, coverageBefore: ratio(beforeSlots, beforeNorm), coverageAfter: ratio(afterSlots, afterNorm), beforeSlots, afterSlots, beforeNorm, afterNorm, beforePlan, afterPlan, beforeGoal, afterGoal, planUp, planDown, goalUp, goalDown, oldDeficit, newDeficit, movers, bestMovers, worstMovers, matchedCount: matched.length, currentCount: current.length };
  }).filter((item): item is NonNullable<typeof item> => item !== null), [visibleOrganizations]);
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
    ? visibleOrganizations.filter((org) => matchesMoSearch(org.name, organizationSearch)).slice(0, 8)
    : [];
  const matrixSuggestions = matrixSearch.trim().length > 0
    ? visibleOrganizations.filter((org) => matchesMoSearch(org.name, matrixSearch)).slice(0, 6)
    : [];
  const matrixRows = organizationRows
    .filter(({ org }) => matchesMoSearch(shownOrgName(org), matrixSearch))
    .sort((a, b) => {
      const valueFor = (row: typeof a): string | number | null => {
        if (matrixSort.key === "name") return matrixOrgName(row.org).toLocaleLowerCase("ru");
        if (matrixSort.key === "deficit") return row.deficit;
        if (matrixSort.key === "coverage") return row.coverage;
        if (matrixSort.key === "balanced") return row.balanced.attainment;
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
  const frmrReviewRows = selectedSpecialties.filter((row) => row.norm === 0 && row.epguSlots !== null && row.epguSlots > 0);
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
  const frmrMoId = selectedOrg?.oid.startsWith(FRMR_OID_PREFIX) ? selectedOrg.oid.slice(FRMR_OID_PREFIX.length) : null;
  const frmrMatched = Boolean(frmrMoId && FRMR_MO_IDS.has(frmrMoId));
  const zeroSlotSpecialties = selectedSpecialties.filter((row) => row.norm !== null && row.norm > 0 && row.epguSlots === 0);
  const frmrZeroSlotIssues = new Map(zeroSlotSpecialties.map((row) => [
    row.code, getFrmrSpecialtyIssues(selectedOrg!.oid, row.code, frmrRaw.summary.rows),
  ]));
  const frmrZeroSlotFlagged = [...frmrZeroSlotIssues.values()].filter((row) => row.count !== null && row.count > 0).length;
  const frmoOrganizationFindings = selectedOrg ? getFrmoOrganizationFindings(selectedOrg.oid, frmoLinkageRaw.organizations) : null;

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
      <div className={styles.heroResult}><span>И‑38.9 · слоты ЕПГУ от общего норматива</span><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><small>План — 60% · цель — 70%</small></div>
    </header>

    <nav className={styles.tabs} aria-label="Разделы И38">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Обзор МЗ РТ</button>
      <button type="button" className={tab === "organization" ? styles.tabActive : ""} onClick={() => setTab("organization")}>Медорганизация</button>
    </nav>

    {tab === "overview" && <main className={styles.page}>
      <div className={styles.overviewGrid}>
        <div className={styles.kpis}>
          <article className={styles.kpi}><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><span>Общий процент И‑38.9</span><small>{format(regional.epguSlots)} слотов ЕПГУ ÷ {format(regional.norm)} «Норматив ВСЕГО»</small></article>
          <article className={styles.kpi}><strong className={styles.good}>{completeCount}</strong><span>МО выполнили план 60%</span><small>И‑38.9 каждой МО не ниже 60%</small></article>
          <article className={styles.kpi}><strong className={styles.belowNorm}>{belowCount}</strong><span>МО ниже плана 60%</span><small>С полными данными</small></article>
          <article className={styles.kpi}><strong>{format(regional.deficit)}</strong><span>Не хватает слотов до плана</span><small>Минимальная нехватка по каждой МО</small></article>
          <article className={styles.kpi}><strong className={styles.neutral}>{missingCount}</strong><span>МО с неполными данными</span><small>Не считаются нулём</small></article>
        </div>
        <article className={styles.maxGroupCard}>
          <span className={styles.maxGroupEyebrow}>РАБОЧАЯ ГРУППА</span>
          <h2>Инцидент 38 в MAX</h2>
          <a className={styles.maxGroupLink} href="https://max.ru/join/_IjdDQBUBT835_Cz_fdY4ELQ8X2u72CuZGndk1cTcq8" target="_blank" rel="noreferrer">Открыть чат <span aria-hidden="true">↗</span></a>
        </article>
      </div>
      <section className={styles.card} aria-label="Динамика И38 между обновлениями">
        <div className={styles.sectionHead}><div><h2>Динамика между обновлениями</h2><p>Исторические срезы сравниваются отдельно: даты городской и районной выгрузок различаются. Изменение доли указано в процентных пунктах. «+ / −» у МО — переходы через порог в обе стороны.</p></div></div>
        <div className={styles.historyGrid}>{scopeHistory.map((item) => <article className={styles.historyPanel} key={item.scope}>
          <div className={styles.historyHead}><strong>{item.label}</strong><small>{item.prior.reportDate} → {item.date} · {item.matchedCount} сопоставимых МО{item.matchedCount !== item.currentCount ? ` из ${item.currentCount}` : ""}</small></div>
          <div className={styles.historyMain}><span>{percent(item.coverageBefore)} → <b>{percent(item.coverageAfter)}</b></span><strong className={(item.coverageAfter ?? 0) >= (item.coverageBefore ?? 0) ? styles.good : styles.bad}>{item.coverageAfter === null || item.coverageBefore === null ? "—" : `${item.coverageAfter >= item.coverageBefore ? "+" : ""}${numberFormat.format(item.coverageAfter - item.coverageBefore)} п. п.`}</strong></div>
          <div className={styles.historyTrack}><i style={{ width: `${Math.min(100, Math.max(0, item.coverageAfter ?? 0))}%` }} /><span className={styles.historyPlan} title="План 60%" /><span className={styles.historyGoal} title="Цель 70%" /></div><div className={styles.historyThresholds}><span>План 60%</span><span>Цель 70%</span></div>
          <div className={styles.historyFacts}><span>План 60%: <b>{item.afterPlan}</b> <small>(+{item.planUp} / −{item.planDown})</small></span><span>Цель 70%: <b>{item.afterGoal}</b> <small>(+{item.goalUp} / −{item.goalDown})</small></span><span>Слоты ЕПГУ: <b>{format(item.afterSlots)}</b> <small>({item.afterSlots - item.beforeSlots >= 0 ? "+" : ""}{format(item.afterSlots - item.beforeSlots)})</small></span><span>Норматив: <b>{format(item.afterNorm)}</b> <small>({item.afterNorm - item.beforeNorm >= 0 ? "+" : ""}{format(item.afterNorm - item.beforeNorm)})</small></span><span>Дефицит: <b>{format(item.newDeficit)}</b> <small>({item.newDeficit - item.oldDeficit >= 0 ? "+" : ""}{format(item.newDeficit - item.oldDeficit)})</small></span></div>
          <details className={styles.historyDetails}><summary>Изменения по МО · 5 лучших / 5 худших</summary>{([{ label: "Лучшие результаты", rows: item.bestMovers }, { label: "Худшие результаты", rows: item.worstMovers }]).map((group) => <div className={styles.historyMoverGroup} key={group.label}><h3>{group.label}</h3><div className={styles.historyMovers}>{group.rows.length ? group.rows.map((row) => <button type="button" key={row.oid} onClick={() => openOrg(row.oid)}><span>{row.name}</span><b className={row.after! > row.before! ? styles.historyPositive : styles.historyNegative}>{row.after! > row.before! ? "+" : ""}{numberFormat.format(row.after! - row.before!)} п. п.</b><small className={row.slotsDelta > 0 ? styles.historyPositive : row.slotsDelta < 0 ? styles.historyNegative : ""}>слоты {row.slotsDelta >= 0 ? "+" : ""}{format(row.slotsDelta)}</small></button>) : <p className={styles.historyNoMovers}>Нет МО с изменением в эту сторону</p>}</div></div>)}</details>
        </article>)}</div>
        <p className={styles.matrixMethod}>Сравнение по одинаковым OID и типу МО; новые или отсутствующие строки не считаются нулём. Суммы слотов и нормативов сравниваются отдельно. Разбивка изменений по специальностям для старого среза не показывается до повторной сверки архивного источника.</p>
      </section>
      <div className={styles.note}><b>Как читать показатель:</b> Реальный процент = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%. План каждой МО — 60%, цель — 70%. Нехватка = max(0, округление вверх(«Норматив ВСЕГО» × 60%) − «Слотов для ЕПГУ»), считается отдельно по каждой МО. Общий процент — сумма слотов ЕПГУ, делённая на сумму общего норматива. В расчёте учитываются все слоты ЕПГУ, в том числе по специальностям с нулевым нормативом. {DATA[0].reportDate === DATA[1].reportDate ? `Обе выгрузки на ${DATA[0].reportDate}.` : `Даты выгрузок: ${DATA.map((dataset) => dataset.reportDate).join(" и ")}.`} «Норма для ЕПГУ» и «Всего слотов» не влияют на этот показатель.</div>
      <div className={styles.grid2}>
        <section className={styles.card}><h2>Распределение МО по достижению плана</h2><p className={styles.chartNote}>Сколько организаций достигло разных уровней от индивидуального плана 60%. Достижение плана = И‑38.9 МО ÷ 60%. В расчёт включены МО с полными данными: {completeOrganizations.length}.</p>
          <div className={styles.planDistribution}>{planDistribution.map((band) => <div className={styles.planDistributionRow} key={band.key}><span>{band.label}</span><div className={styles.track}><i style={{ width: `${band.count / maxPlanDistribution * 100}%`, background: band.color }} /></div><strong>{band.count}</strong><small>{percent(band.share)}</small></div>)}</div>
          <p className={styles.chartNote}>МО без полных данных: {missingCount}. «100–&lt;120%» означает выполнение плана с превышением до 20%.</p>
        </section>
        <section className={styles.card}><h2>Специальности с наибольшим дефицитом слотов</h2><p className={styles.chartNote}>Показаны специальности с наименьшим общим процентом И‑38.9. «МО без слотов» — организации, где норматив есть, а слотов ЕПГУ нет. План 60% применяется к МО в целом; ранжирование специальностей — диагностическое.</p>
          <div className={styles.deficitSpecialties}>{[...specRows].filter((row) => row.norm !== null && row.norm > 0).slice(0, 5).map((row, index) => <div className={styles.deficitSpecialty} key={row.code}><b>{index + 1}</b><span title={row.name}>{row.name}</span><div className={styles.track}><i style={{ width: `${Math.min(100, Math.max(0, row.coverage ?? 0))}%`, background: heatColor(row.coverage) }} /></div><strong className={styles.neutral}>{percent(row.coverage)}</strong><small>{row.zeroSlotsOrganizations} МО без слотов</small></div>)}</div>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Рейтинг медицинских организаций</h2><p>По умолчанию — от худшего по <b>сбалансированному выполнению цели 70%</b>: каждый профиль учитывается не выше 70% своего норматива, и избыток слотов не закрывает дефицит другого профиля. Под ним в том же столбце — <b>официальное выполнение плана И‑38.9 (60%)</b>. «Спец. с 0 слотами» — специальности с положительным нормативом, но без слотов ЕПГУ.</p></div>
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
          <th className={styles.attainmentHead}><button type="button" className={styles.sortButton} onClick={() => toggleMatrixSort("balanced")} title="Управленческий показатель: 100% означает достижение 70% норматива каждой применимой специальности, без взаимной компенсации">Баланс 70%, %{sortMark("balanced")}</button><button type="button" className={styles.secondarySort} onClick={() => toggleMatrixSort("attainment")} title="Официальное выполнение плана И‑38.9: 100% означает достижение плана 60% по МО в целом">План 60%, %{sortMark("attainment")}</button></th>
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
            <td className={styles.shortfallCell} title={`Минимум слотов до плана 60%: ${format(row.deficit)}`} onClick={() => openOrg(row.org.oid)}>{format(row.deficit)}</td>
            <td className={styles.attainmentCell} title={`Баланс 70% — ${percent(row.balanced.attainment)}: каждый профиль ограничен уровнем 70% его норматива, избыток не переносится. Официальное выполнение плана 60% — ${row.coverage === null ? "—" : percent(row.coverage / PLAN_PERCENT * 100)}`}><strong className={`${styles.balancedResult} ${row.balanced.attainment === null ? styles.neutral : row.balanced.attainment >= 99.999999 ? styles.good : styles.belowNorm}`}>{percent(row.balanced.attainment)}</strong><small className={styles.officialResult}>{row.coverage === null ? "—" : percent(row.coverage / PLAN_PERCENT * 100)}</small></td>
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
        <p className={styles.matrixMethod}><b>Сбалансированный рейтинг (управленческий):</b> сумма min(слоты ЕПГУ, 70% норматива) по каждой специальности с положительным нормативом ÷ сумму 70% этих нормативов × 100%. Среднее арифметическое процентов специальностей не используется. Перевыполнение одной специальности не компенсирует дефицит другой. Специальности без норматива исключены, пропуски данных не считаются нулями. <b>Официальный показатель не изменён:</b> выполнение плана = И‑38.9 ÷ 60% × 100%. Например, 60% общего норматива — это 100% выполнения плана. «Спец. с 0 слотами» учитывает только специальности с заданным положительным нормативом. Если норматив равен 0, но слоты ЕПГУ есть, проверьте должность и привязку СП в разделе 06 «ФРМР ↔ ГИС»; это отдельный диагностический случай.</p><p className={styles.matrixMobileHint}>Нажмите «Специальности» в строке МО, чтобы увидеть разбивку по 14 специальностям.</p>
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
        <div className={styles.sectionHead}><div><h2>{selectedOrg.name}</h2><p>И‑38.9 = слоты ЕПГУ ÷ «Норматив ВСЕГО» × 100%. План для МО — 60%, цель — 70%; статус показывает его выполнение.</p></div>
          <div className={styles.frmrShortcutActions}>
            <span className={`${styles.status} ${!orgMetrics(selectedOrg).complete ? styles.statusMissing : orgMetrics(selectedOrg).meetsPlan ? styles.statusComplete : styles.statusBelow}`}>{status(orgMetrics(selectedOrg).coverage)}</span>
            {frmrMatched
              ? <button type="button" className={styles.frmrShortcut} onClick={() => onOpenFrmrMo(selectedOrg.oid)}>Проверить ошибки в ФРМР <span aria-hidden="true">↗</span></button>
              : <small className={styles.frmrUnmatched}>МО не сопоставлена с разделом 06 по OID</small>}
          </div>
        </div>
        <div className={styles.orgKpis}>
          <article><strong className={planTone(orgMetrics(selectedOrg).coverage)}>{percent(orgMetrics(selectedOrg).coverage)}</strong><span>И‑38.9 · план 60%, цель 70%</span><small>{format(orgMetrics(selectedOrg).epguSlots)} слотов ЕПГУ из {format(orgMetrics(selectedOrg).norm)} по общему нормативу</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).targetSlots)}</strong><span>Слотов нужно для плана</span><small>60% общего норматива, округление вверх</small></article>
          <article><strong>{format(orgMetrics(selectedOrg).deficit)}</strong><span>Не хватает до плана</span><small>минимальное число дополнительных слотов ЕПГУ</small></article>
          <article><strong className={selectedBalanced?.attainment !== null && selectedBalanced?.attainment !== undefined && selectedBalanced.attainment >= 99.999999 ? styles.good : styles.belowNorm}>{percent(selectedBalanced?.attainment ?? null)}</strong><span>Сбалансированное выполнение цели 70%</span><small>{selectedBalanced?.attainment === null ? "Нет полных данных или применимых специальностей" : `${selectedBalanced?.reachedCount ?? 0} из ${selectedBalanced?.eligibleCount ?? 0} специальностей достигли 70%`}</small></article>
        </div>
        {selectedBalanced?.attainment !== null && selectedBalanced?.attainment !== undefined && <p className={styles.balancedNote}><b>Контроль баланса:</b> превышение по отдельным специальностям ({format(selectedBalanced.excessSlots)} слотов сверх 70% их норматива) не используется для компенсации дефицита других профилей. Этот показатель — внутренний, официальный И‑38.9 и план 60% не изменены.</p>}
        {zeroSlotSpecialties.length > 0 && <div className={styles.frmrDiagnostic} role="note">
          <strong>Проверка связи ГИС–ФРМР/ФРМО · {zeroSlotSpecialties.length} специальностей с нулевыми слотами</strong>
          <p>В выгрузке <b>расхождений ФРМР от {frmrRaw.summary.sourceCut}</b> по соответствующим должностям есть проблемные записи у {frmrZeroSlotFlagged} из {zeroSlotSpecialties.length} специальностей. Конкретные профили отмечены ниже.</p>
          <p>Сверка ФРМО от {frmoLinkageRaw.cut}: {frmoOrganizationFindings?.matched
            ? frmoOrganizationFindings.issues === null
              ? "количество отклонений по подразделениям МО не определено"
              : `${frmoOrganizationFindings.issues} строк с признаками расхождений по МО из ${format(frmoOrganizationFindings.rows)} строк`
            : frmoOrganizationFindings?.ambiguous
              ? "несколько совпадающих привязок OID МО — требуется проверка"
              : "нет однозначного сопоставления МО по OID"}.</p>
          <p><b>Важно:</b> эти выгрузки не содержат полного списка врачей и не устанавливают причину отсутствия слотов. При отсутствии записей по должности нельзя считать, что врач отсутствует. Проверьте кадровые сведения, привязку СП, расписание МИС и доступность слотов на ЕПГУ.</p>
        </div>}
        {frmrReviewRows.length > 0 && <p className={styles.chartNote}><b>Проверить ФРМР: {frmrReviewRows.length} специальностей.</b> Есть слоты ЕПГУ при нулевом нормативе. Нажмите «Проверить ошибки в ФРМР» выше: откроется карточка этой МО в разделе 06 с детализацией должностей, СП и записей. Подтверждённые ошибки исправьте в первичном источнике. Нулевой норматив сам по себе не доказывает ошибку.</p>}
        <div className={styles.sectionHead}><div><h2>Показатели по специальностям</h2><p>Значения по специальностям справочные: план 60% применяется к общему показателю МО. Медиана сравнивает МО с другими организациями того же набора выгрузки.</p></div><select className={styles.inlineSelect} value={selectedSpecialty} onChange={(event) => setSelectedSpecialty(event.target.value)}><option value="">Все специальности</option>{SPECIALTIES.map((specialty) => <option key={specialty.code} value={specialty.code}>{specialty.name}</option>)}</select></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Специальность</th><th>Норматив ВСЕГО</th><th>Слотов для ЕПГУ</th><th>И‑38.9, %</th><th>Медиана выборки, %</th><th>Отклонение, п.п.</th><th>МО в выборке</th></tr></thead><tbody>
          {displaySpecialties.map((row) => {
            const benchmark = benchmarkBySpecialty.get(row.code);
            const difference = row.coverage !== null && benchmark?.median !== null && benchmark?.median !== undefined ? row.coverage - benchmark.median : null;
            return <tr key={row.code}><td className={styles.orgName}>{row.name}{row.norm !== null && row.norm > 0 && row.epguSlots === 0 && <small className={styles.frmrInlineDiagnostic} title={frmrZeroSlotIssues.get(row.code)?.roles.map((record) => `${record.name}: ${record.count}`).join("; ") || "Нулевая запись слотов требует проверки МИС, ФРМР и ФРМО"}>{(frmrZeroSlotIssues.get(row.code)?.count ?? 0) > 0 ? `ФРМР: ${format(frmrZeroSlotIssues.get(row.code)!.count)} записей с расхождениями` : "Связку с ФРМР/ФРМО нужно проверить"}</small>}{row.norm === 0 && row.epguSlots !== null && row.epguSlots > 0 && <small style={{ display: "block", color: "#986118", fontWeight: 700 }}>Проверить ФРМР</small>}</td><td>{format(row.norm)}</td><td>{format(row.epguSlots)}</td><td className={`${styles.metricCell} ${specialtyBand(row.coverage)}`}>{percent(row.coverage)}</td><td>{percent(benchmark?.median ?? null)}</td><td className={difference === null ? styles.neutral : difference >= 0 ? styles.good : styles.belowNorm}>{difference === null ? "—" : <>{difference > 0 ? "+" : ""}{numberFormat.format(difference)}</>}</td><td>{benchmark?.count ?? 0}</td></tr>;
          })}
        </tbody></table></div>
        <section className={styles.orgInsights}>
          <article><h3>Организация относительно выборки</h3><p>По выбранным специальностям ниже медианы: <b>{belowMedianCount}</b>; на уровне или выше: <b>{aboveMedianCount}</b>.</p></article>
          <article><h3>Управленческий вывод</h3><p>Специальностей с уровнем ниже 25%: <b>{criticalCount}</b>. Самые низкие значения: {weakestSpecialties.length ? weakestSpecialties.map((row) => `${row.name} — ${percent(row.coverage)}`).join("; ") : "нет данных"}.</p></article>
        </section>
        <div className={styles.specialtyLegend}><span><i className={styles.specialtyGreen} />≥75% — высокий уровень</span><span><i className={styles.specialtyYellow} />50–74% — требует внимания</span><span><i className={styles.specialtyOrange} />25–49% — зона риска</span><span><i className={styles.specialtyRed} />&lt;25% — критично</span><span>Цветовой ориентир для специальности; план 60% оценивается по МО в целом.</span></div>
        <p className={styles.chartNote}>Медиана рассчитана по МО той же выгрузки: {benchmarkOrganizations.length} организаций · срез {benchmarkDataset?.reportDate ?? "—"}. В выборку по специальности входят МО с положительным общим нормативом; нулевые значения слотов учитываются.</p>
      </section>}
    </main>}

    <footer className={styles.footer}>Источник: форма И‑38.9, лист «нормативы». Реальный процент И‑38.9 = «Слотов для ЕПГУ» ÷ «Норматив ВСЕГО» × 100%; план каждой МО — 60%, цель — 70%. Нехватка рассчитывается по каждой МО как минимальное целое число дополнительных слотов до 60% общего норматива. «Норма для ЕПГУ» и «Всего слотов» в оценке не используются. Итог по региону — отношение суммы слотов к сумме общего норматива. Даты срезов: {DATA.map((dataset) => dataset.reportDate).join(" · ")}. По правилу реорганизации Альметьевска из текущего отчёта исключены прежние МО, головная организация сохранена. Отсутствие данных не заменяется нулём; государственные/частные организации разделены по организационно-правовой форме.</footer>
  </div>;
}
