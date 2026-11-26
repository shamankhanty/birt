"use client";

import { Fragment, useMemo, useState } from "react";
import cityRaw from "./incident38-cities.json";
import districtRaw from "./incident38-districts.json";
import historyRaw from "./incident38-history.json";
import frmrRaw from "./frmr-all-specialties.json";
import frmoLinkageRaw from "./frmo-linkage-data-20261126.json";
import { getFrmrSpecialtyIssues, getFrmoOrganizationFindings } from "../lib/incident38-frmr-diagnostic.js";
import { balancedSpecialties } from "../lib/incident38-balanced-specialties.js";
import reorganizationRaw from "../config/mo-reorganizations.json";
import styles from "./incident38-dashboard.module.css";

type SlotValue = number | null;
type Specialty = { code: string; name: string; norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue };
type Organization = { oid: string; code: string; name: string; fullName: string; city: string; totals: { norm: SlotValue; slots: SlotValue; epguNorm: SlotValue; epguSlots: SlotValue; sourcePercent: number | null }; specialties: Specialty[] };
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
const format = (value: SlotValue) => value === null || value === undefined ? "‚Äî" : numberFormat.format(value);
const percent = (value: number | null) => value === null || !Number.isFinite(value) ? "‚Äî" : `${numberFormat.format(value)}%`;
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
const isPrivateOrganization = (org: Organization) => /^(–û–û–û|–ß–£–ó|–ò–ü|–ê–ù–û|–ó–ê–û|–û–ê–û|–ù–ß–û–£)\s/i.test(org.name.trim());
function metrics(rows: Specialty[]) {
  const norm = sumKnown(rows.map((row) => row.norm));
  const epguSlots = rows.some((row) => row.norm === null || row.epguSlots === null) ? null : rows.filter((row) => row.norm! > 0).reduce((sum, row) => sum + row.epguSlots!, 0);
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

const orgMetrics = (org: Organization) => {
  const { norm, epguSlots } = org.totals;
  const coverage = ratio(epguSlots, norm);
  const complete = norm !== null && epguSlots !== null;
  const deficit = complete ? planShortfall(epguSlots, norm) : null;
  return { norm, epguSlots, coverage, deficit, targetSlots: norm === null ? null : Math.ceil(norm * PLAN_RATIO), complete, meetsPlan: coverage !== null && coverage >= PLAN_PERCENT, missing: complete ? 0 : 1 };
};

function aggregateOrganizationTotals(orgs: Organization[]) {
  const norm = sumKnown(orgs.map((org) => org.totals.norm));
  const epguSlots = sumKnown(orgs.map((org) => org.totals.epguSlots));
  const coverage = ratio(epguSlots, norm);
  const complete = orgs.every((org) => org.totals.norm !== null && org.totals.epguSlots !== null);
  const deficit = complete ? sumKnown(orgs.map((org) => orgMetrics(org).deficit)) : null;
  return { norm, epguSlots, coverage, deficit, targetSlots: norm === null ? null : Math.ceil(norm * PLAN_RATIO), complete, meetsPlan: coverage !== null && coverage >= PLAN_PERCENT, missing: orgs.filter((org) => org.totals.norm === null || org.totals.epguSlots === null).length };
}

/** Read-only reuse of the same source, ownership rules and formula as –ò-38.9. */
export function getVitrinaIncident38(includePrivate: boolean) {
  const orgs = ORGANIZATIONS.filter(org => includePrivate || !isPrivateOrganization(org));
  const dates = [...new Set(DATA.map(dataset => dataset.reportDate))];
  const horizons = [...new Set(DATA.map(dataset => dataset.forwardDays))];
  const unique = new Set(orgs.map(org => org.oid)).size === orgs.length;
  const comparable = dates.length === 1 && horizons.length === 1 && unique;
  const total = comparable ? aggregateOrganizationTotals(orgs) : null;
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
const status = (value: number | null) => value === null ? "–ù–µ—Ç –¥–∞–Ω–Ω—ã—Ö" : value >= GOAL_PERCENT ? "–¶–µ–ª—å 70% –¥–æ—Å—Ç–∏–≥–Ω—É—Ç–∞" : value >= PLAN_PERCENT ? "–ü–ª–∞–Ω 60% –≤—ã–ø–æ–ª–Ω–µ–Ω" : "–ù–∏–∂–µ –ø–ª–∞–Ω–∞ 60%";
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
  .replace(/^(?:(?:–†–ï–°–ü–£–ë–õ–ò–ö–ò\s+–¢–ê–¢–ê–†–°–¢–ê–ù|–§–ì–ê–û–£|–§–ì–ë–û–£|–§–ì–ë–£|–§–ì–ö–£|–ì–ê–£–ó|–ì–ë–£–ó|–ì–ö–£–ó|–ì–ê–£|–ì–ë–£|–ì–ö–£|–ú–ë–£–ó|–ú–£–ó|–ì–£–ó|–û–û–û|–ê–û|–ß–£–ó|–ê–ù–û|–ó–ê–û|–û–ê–û|–ù–ß–û–£|–§–ö–£|–í–û|–†–¢|–†–§)\s+)+/i, "")
  .replace(/^\s*[¬´"]|[¬ª"]\s*$/g, "")
  .trim();

function OwnershipSwitch({ value, onChange }: { value: Ownership; onChange: (value: Ownership) => void }) {
  return <div className={styles.ownership} role="group" aria-label="–¢–∏–ø –º–µ–¥–∏—Ü–∏–Ω—Å–∫–æ–π –æ—Ä–≥–∞–Ω–∏–∑–∞—Ü–∏–∏">
    <button type="button" className={value === "state" ? styles.ownershipActive : ""} onClick={() => onChange("state")}>–ì–æ—Å—É–¥–∞—Ä—Å—Ç–≤–µ–Ω–Ω—ã–µ</button>
    <button type="button" className={value === "private" ? styles.ownershipActive : ""} onClick={() => onChange("private")}>–ß–∞—Å—Ç–Ω—ã–µ</button>
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
    const totals = aggregateOrganizationTotals(visibleOrganizations);
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
    return { scope, label: index === 0 ? "–ö–∞–∑–∞–Ω—å –∏ –ù–∞–±–µ—Ä–µ–∂–Ω—ã–µ –ß–µ–ª–Ω—ã" : "–†–∞–π–æ–Ω—ã", prior, date: dataset.reportDate, coverageBefore: ratio(beforeSlots, beforeNorm), coverageAfter: ratio(afterSlots, afterNorm), beforeSlots, afterSlots, beforeNorm, afterNorm, beforePlan, afterPlan, beforeGoal, afterGoal, planUp, planDown, goalUp, goalDown, oldDeficit, newDeficit, movers, bestMovers, worstMovers, matchedCount: matched.length, currentCount: current.length };
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
    { key: "lt50", label: "–ú–µ–Ω–µ–µ 50% –ø–ª–∞–Ω–∞", min: 0, max: 50, color: "#b83d47" },
    { key: "50to100", label: "50‚Äì<100% –ø–ª–∞–Ω–∞", min: 50, max: 100, color: "#ca7b37" },
    { key: "100to120", label: "100‚Äì<120% –ø–ª–∞–Ω–∞", min: 100, max: 120, color: "#387a5b" },
    { key: "gte120", label: "120% –ø–ª–∞–Ω–∞ –∏ –≤—ã—à–µ", min: 120, max: Number.POSITIVE_INFINITY, color: "#16875c" },
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
  const sortMark = (key: string) => matrixSort.key === key ? (matrixSort.direction === "asc" ? " ‚Üë" : " ‚Üì") : "";

  return <div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>–†–ê–ó–î–ï–õ –ò38 ¬∑ –§–û–†–ú–ê –ò-38.9</p><h1>–°–ª–æ—Ç—ã –ï–ü–ì–£ –ø–æ –Ω–æ—Ä–º–∞—Ç–∏–≤–∞–º</h1>
        <p className={styles.subtitle}>–°–≤–æ–±–æ–¥–Ω—ã–µ —Å–ª–æ—Ç—ã –Ω–∞ –±–ª–∏–∂–∞–π—à–∏–µ 14 –¥–Ω–µ–π ¬∑ {ownership === "state" ? "–≥–æ—Å—É–¥–∞—Ä—Å—Ç–≤–µ–Ω–Ω—ã–µ" : "—á–∞—Å—Ç–Ω—ã–µ"} –º–µ–¥–∏—Ü–∏–Ω—Å–∫–∏–µ –æ—Ä–≥–∞–Ω–∏–∑–∞—Ü–∏–∏</p>
        <p className={styles.sourceDates}>–î–∞—Ç—ã –≤—ã–≥—Ä—É–∑–æ–∫: {DATA.map((dataset) => dataset.reportDate).join(" ¬∑ ")} ¬∑ –∞–∫—Ç—É–∞–ª—å–Ω–æ—Å—Ç—å –§–†–ú–†: {DATA.map((dataset) => dataset.frmoDate).join(" ¬∑ ")}</p>
      </div>
      <div className={styles.heroResult}><span>–ò‚Äë38.9 ¬∑ —Å–ª–æ—Ç—ã –ï–ü–ì–£ –æ—Ç –æ–±—â–µ–≥–æ –Ω–æ—Ä–º–∞—Ç–∏–≤–∞</span><strong className={planTone(regional.coverage)}>{percent(regional.coverage)}</strong><smavÎmm¢Gß≤⁄Óù∆≠yﬁÙc4/t/¥,Ù/à4/Ù.Ù,4/t,å	Kà4%4/¥`t`¥.4-¥-t/t.4-H4/Ù.Ù,4/t,H4&8†$LŒéH4'4'à0Ì»å	Kà4$à4`4,4`taÙdt`à4,¥.¥.Ùc¥aÙ-t/tb»4'4'à4`H4/Ù/¥.Ù/tbÙ/4.4-4,4/t/tbÙ/4.àÿ€€\]S‹ôÿ[ö^ò][€úÀõ[ô›Kè‹Çà]à€\‹”ò[YO^‹›[\Àú[ë\›öXù][€üOû‹[ë\›öXù][€ãõX\

ò[ô
HOà]à€\‹”ò[YO^‹›[\Àú[ë\›öXù][€îõ›ﬂHŸ^O^ÿò[ôöŸ^_Oè‹[èûÿò[ôõXô[O‹‹[èè]à€\‹”ò[YO^‹›[\ÀùòX⁄ﬂOèH›[O^ﬁ»⁄Yà	ÿò[ôò€›[ù»X^[ë\›öXù][€à
àLIXòX⁄Ÿ‹õ›[ôàò[ôò€€‹à_HœèŸ]èè›õ€ôœûÿò[ôò€›[ùO‹›õ€ôœè€X[û‹\òŸ[ù
ò[ôú⁄\ôJ_O‹€X[èŸ]èä_OŸ]èÇà€\‹”ò[YO^‹›[\Àò⁄\ùõ›_O¥'4'à4,t-t-»4/Ù/¥.Ù/tbÙaH4-4,4/t/tbÙaNà€Z\‹⁄[ô–€›[ùKà0™ÃL8†$…õÃLå	pÆ»4/¥-Ù/t,4aÙ,4-t`à4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/Ù.Ù,4/t,4`H4/Ù`4-t,¥bÙb4-t/t.4-t/4-4/àå	Kè‹Çà‹ŸX›[€èÇàŸX›[€à€\‹”ò[YO^‹›[\Àòÿ\ôOèè¥(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4`H4/t,4.4,t/¥.Ùc4b4.4/4-4-ta4.4a¥.4`¥/¥/4`t.Ù/¥`¥/¥,è⁄èè€\‹”ò[YO^‹›[\Àò⁄\ùõ›_O¥'Ù/¥.¥,4-Ù,4/tb»4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4`H4/t,4.4/4-t/tc4b4.4/4/¥,tbt.4/4/Ù`4/¥a¥-t/t`¥/¥/4&8†$LŒéKà0™Ù'4'à4,t-t-»4`t.Ù/¥`¥/¥,∞Æ»8†%4/¥`4,Ù,4/t.4-Ù,4a¥.4.4,Ù-4-H4/t/¥`4/4,4`¥.4,à4-t`t`¥c4,4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(»4/t-t`ãà4'Ù.Ù,4/Hå	H4/Ù`4.4/4-t/tcÙ-t`¥`tc»4.à4'4'à4,à4a¥-t.Ù/¥/»4`4,4/t-¥.4`4/¥,¥,4/t.4-H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H8†%4-4.4,4,Ù/t/¥`t`¥.4aÙ-t`t.¥/¥-Kè‹Çà]à€\‹”ò[YO^‹›[\ÀôYöX⁄]‹X⁄X[Y\ﬂOû÷Àããú‹X‘õ›‹◊Kôö[\ä
õ› HOàõ›Àõõ‹õHOOHù[	âàõ›Àõõ‹õHà
Kú€XŸJJKõX\

õ›À[ô^
HOà]à€\‹”ò[YO^‹›[\ÀôYöX⁄]‹X⁄X[_HŸ^O^‹õ›Àò€Ÿ_Oèèû⁄[ô^
»_Oÿèè‹[à]O^‹õ›Àõò[Y_Oû‹õ›Àõò[Y_O‹‹[èè]à€\‹”ò[YO^‹›[\ÀùòX⁄ﬂOèH›[O^ﬁ»⁄Yà	”X]õZ[äLX]õX^
õ›Àò€›ô\òYŸHœ»
J_IXòX⁄Ÿ‹õ›[ôàX]€€‹äõ›Àò€›ô\òYŸJH_HœèŸ]èè›õ€ô»€\‹”ò[YO^‹›[\Àõô]]ò[Oû‹\òŸ[ù
õ›Àò€›ô\òYŸJ_O‹›õ€ôœè€X[û‹õ›Àûô\õ‘€›”‹ôÿ[ö^ò][€úﬂH4'4'à4,t-t-»4`t.Ù/¥`¥/¥,è‹€X[èŸ]èä_OŸ]èÇà‹ŸX›[€èÇàŸ]èÇàŸX›[€à€\‹”ò[YO^‹›[\Àòÿ\ôOÇà]à€\‹”ò[YO^‹›[\ÀúŸX›[€íXYOè]èèè¥(4-t.t`¥.4/t,»4/4-t-4.4a¥.4/t`t.¥.4aH4/¥`4,Ù,4/t.4-Ù,4a¥.4.O⁄èè¥'Ù/à4`Ù/4/¥.ÙaÙ,4/t.4cà8†%4/¥`à4at`Ù-4b4-t,Ù/à4/Ù/àè¥`t,t,4.Ù,4/t`t.4`4/¥,¥,4/t/t/¥/4`»4,¥bÙ/Ù/¥.Ù/t-t/t.4cà4a¥-t.Ù.Ã	Oÿèéà4.¥,4-¥-4bÙ.H4/Ù`4/¥a4.4.Ùc4`ÙaÙ.4`¥bÙ,¥,4-t`¥`tc»4/t-H4,¥bÙb4-HÃ	H4`t,¥/¥-t,Ù/à4/t/¥`4/4,4`¥.4,¥,4.4.4-Ù,tbÙ`¥/¥.à4`t.Ù/¥`¥/¥,à4/t-H4-Ù,4.¥`4bÙ,¥,4-t`à4-4-ta4.4a¥.4`à4-4`4`Ù,Ù/¥,Ù/à4/Ù`4/¥a4.4.ÙcÀà4'Ù/¥-4/t.4/4,à4`¥/¥/4-¥-H4`t`¥/¥.Ù,ta¥-H8†%è¥/¥a4.4a¥.4,4.Ùc4/t/¥-H4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/Ù.Ù,4/t,4&8†$LŒéH
å	JOÿèãà0™Ù(t/Ù-taãà4`H4`t.Ù/¥`¥,4/4.0Æ»8†%4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4`H4/Ù/¥.Ù/¥-¥.4`¥-t.Ùc4/tbÙ/4/t/¥`4/4,4`¥.4,¥/¥/4/t/à4,t-t-»4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(Àè‹èŸ]èÇà]à€\‹”ò[YO^‹›[\ÀõX]ö^€€ùõ€ﬂOÇà›€ô\ú⁄\›⁄]⁄ò[YO^€›€ô\ú⁄\H€ê⁄[ôŸO^ÿ⁄[ôŸS›€ô\ú⁄\HœÇàXô[€\‹”ò[YO^‹›[\ÀõX]ö^ŸX\ò⁄O¥'Ù/¥.4`t.à4/Ù/à4'4'è]à€\‹”ò[YO^‹›[\Àú›YŸŸ\›[€êõﬁOè[ú]ò[YO^€X]ö^ŸX\ò⁄H€ê⁄[ôŸO^ ]ô[ù
HOàŸ]X]ö^ŸX\ò⁄
]ô[ùù\ôŸ]ùò[YJ_HXŸZ€\èH¥'t,4aÙ/t.4`¥-H4,¥,¥/¥-4.4`¥c4/t,4-Ù,¥,4/t.4-Hà]]–€€\]OHõŸôààœÇà€X]ö^›YŸŸ\›[€úÀõ[ô›à	âà]à€\‹”ò[YO^‹›[\Àú›YŸŸ\›[€úﬂOû€X]ö^›YŸŸ\›[€úÀõX\

‹ô HOàù]€à\OHòù]€ààŸ^O^€‹ôÀõ⁄YH€ê€X⁄œ^ 
HOà‹[ì‹ô ‹ôÀõ⁄Y
_Oè›õ€ôœû€X]ö^‹ô”ò[YJ‹ô _O‹›õ€ôœè‹[èû€‹ôÀò⁄]_O‹‹[èèÿù]€èä_OŸ]èüBàŸ]èè€Xô[ÇàŸ]èÇàŸ]èÇà]à€\‹”ò[YO^‹›[\ÀõX]ö^ÿ‹õ€OèXõH€\‹”ò[YO^‹›[\ÀöX]Oè€€‹õ›\è€€€\‹”ò[YO^‹›[\Àõ‹ô–€€Hœè€€€\‹”ò[YO^‹›[\Àú⁄‹ùò[€€Hœè€€€\‹”ò[YO^‹›[\Àò]Z[õY[ù€€Hœû‘‘P“PSQTÀõX\

‹X⁄X[JHOà€€€\‹”ò[YO^‹›[\Àú‹X⁄X[P€€HŸ^O^‹‹X⁄X[Kò€Ÿ_Hœä_O€€€\‹”ò[YO^‹›[\Àù›[€€Hœèÿ€€‹õ›\èXYèèÇà€\‹”ò[YO^‹›[\Àú›X⁄ﬁSò[Y_Oèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àú€‹ùù]€üH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
õò[YHä_O¥'4-t-4.4a¥.4/t`t.¥,4c»4/¥`4,Ù,4/t.4-Ù,4a¥.4cﬁ‹€‹ùX\ö õò[YHä_Oÿù]€èè›Çà€\‹”ò[YO^‹›[\Àú⁄‹ùò[XYOèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àú€‹ùù]€üH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
ôYöX⁄]ä_O¥'t-H4at,¥,4`¥,4-t`èúàœ¥-4/à4/Ù.Ù,4/t,‹€‹ùX\ö ôYöX⁄]ä_Oÿù]€èè›Çà€\‹”ò[YO^‹›[\Àò]Z[õY[ùXYOèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àú€‹ùù]€üH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
òò[[òŸYä_H]OH¥(Ù/Ù`4,4,¥.Ù-t/taÙ-t`t.¥.4.H4/Ù/¥.¥,4-Ù,4`¥-t.ÙcàL	H4/¥-Ù/t,4aÙ,4-t`à4-4/¥`t`¥.4-¥-t/t.4-HÃ	H4/t/¥`4/4,4`¥.4,¥,4.¥,4-¥-4/¥.H4/Ù`4.4/4-t/t.4/4/¥.H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4,t-t-»4,¥-Ù,4.4/4/t/¥.H4.¥/¥/4/Ù-t/t`t,4a¥.4.è¥$t,4.Ù,4/t`HÃ	K	^‹€‹ùX\ö òò[[òŸYä_Oÿù]€èèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\ÀúŸX€€ô\ûT€‹ùH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
ò]Z[õY[ùä_H]OH¥'¥a4.4a¥.4,4.Ùc4/t/¥-H4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/Ù.Ù,4/t,4&8†$LŒéNàL	H4/¥-Ù/t,4aÙ,4-t`à4-4/¥`t`¥.4-¥-t/t.4-H4/Ù.Ù,4/t,å	H4/Ù/à4'4'à4,à4a¥-t.Ù/¥/è¥'Ù.Ù,4/Hå	K	^‹€‹ùX\ö ò]Z[õY[ùä_Oÿù]€èè›Çà‘‘P“PSQTÀõX\

‹X⁄X[JHOà€\‹”ò[YO^‹›[\Àúõ›HŸ^O^‹‹X⁄X[Kò€Ÿ_H]O^‹‹X⁄X[Kõò[Y_Oèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àú‹X⁄X[T€‹ùH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
‹X⁄X[Nâ‹‹X⁄X[Kò€Ÿ_X
_Oû‹‹X⁄X[Kõò[YKú›\ù’⁄]
¥$¥'¥'»äH»¥$¥'¥'»àà‹X⁄X[Kõò[Y_^‹€‹ùX\ö ‹X⁄X[Nâ‹‹X⁄X[Kò€Ÿ_X
_Oÿù]€èè›ä_Bà€\‹”ò[YO^‹›[\Àù›[XYOèù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àú€‹ùù]€üH€ê€X⁄œ^ 
HOàŸŸ€SX]ö^€‹ù
ûô\õ‘‹X⁄X[Y\»ä_H]OH¥&¥/¥.Ù.4aÙ-t`t`¥,¥/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H4`H4/Ù/¥.Ù/¥-¥.4`¥-t.Ùc4/tbÙ/4/t/¥`4/4,4`¥.4,¥/¥/4.4/t`Ù.Ùdt/4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(»è¥(t/Ù-taãà4`Húàœ¥`t.Ù/¥`¥,4/4.‹€‹ùX\ö ûô\õ‘‹X⁄X[Y\»ä_Oÿù]€èè›Çà›èè›XYèõŸOÇà€X]ö^õ›‹ÀõX\

õ› HOà¬à€€ú›ô\õ‘‹X⁄X[P€›[ùHõ›Àõ‹ôÀú‹X⁄X[Y\Àôö[\ä
][JHOà][Kõõ‹õHOOHù[	âà][Kõõ‹õHà	âà][Kô\›T€›»OOH
Kõ[ô›¬àô]\õàúòY€Y[ùŸ^O^‹õ›Àõ‹ôÀõ⁄YOèèÇà€\‹”ò[YO^‹›[\Àú›X⁄ﬁSò[Y_H€ê€X⁄œ^ 
HOà‹[ì‹ô õ›Àõ‹ôÀõ⁄Y
_H]O^ÿ	€X]ö^‹ô”ò[YJõ›Àõ‹ô _H0≠»	‹õ›Àõ‹ôÀò⁄]_XOÇà‹[à€\‹”ò[YO^‹›[\ÀõX]ö^ò[Y_Oû€X]ö^‹ô”ò[YJõ›Àõ‹ô _O‹‹[èè€X[€\‹”ò[YO^‹›[\ÀõX]ö^⁄]_Oû‹õ›Àõ‹ôÀò⁄]_O‹€X[Çàù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àõ[ÿö[Q^[ôH\öXKY^[ôY^Ÿ^[ôYX]ö^⁄YOOHõ›Àõ‹ôÀõ⁄YH€ê€X⁄œ^ ]ô[ù
HOà»]ô[ùú›‹õ‹Yÿ][€ä
N»Ÿ]^[ôYX]ö^⁄Y
^[ôYX]ö^⁄YOOHõ›Àõ‹ôÀõ⁄Y»àààõ›Àõ‹ôÀõ⁄Y
N»_O¥(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.Ÿ^[ôYX]ö^⁄YOOHõ›Àõ‹ôÀõ⁄Y»∏•¨ààà∏•ØüOÿù]€èÇà›Çà€\‹”ò[YO^‹›[\Àú⁄‹ùò[Ÿ[H]O^ÿ4'4.4/t.4/4`Ù/4`t.Ù/¥`¥/¥,à4-4/à4/Ù.Ù,4/t,å	Nà	Ÿõ‹õX]
õ›ÀôYöX⁄]
_XH€ê€X⁄œ^ 
HOà‹[ì‹ô õ›Àõ‹ôÀõ⁄Y
_OûŸõ‹õX]
õ›ÀôYöX⁄]
_O›Çà€\‹”ò[YO^‹›[\Àò]Z[õY[ùŸ[H]O^ÿ4$t,4.Ù,4/t`HÃ	H8†%	‹\òŸ[ù
õ›Àòò[[òŸYò]Z[õY[ù
_Nà4.¥,4-¥-4bÙ.H4/Ù`4/¥a4.4.Ùc4/¥,Ù`4,4/t.4aÙ-t/H4`Ù`4/¥,¥/t-t/Ã	H4-t,Ù/à4/t/¥`4/4,4`¥.4,¥,4.4-Ù,tbÙ`¥/¥.à4/t-H4/Ù-t`4-t/t/¥`t.4`¥`tcÀà4'¥a4.4a¥.4,4.Ùc4/t/¥-H4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/Ù.Ù,4/t,å	H8†%	‹õ›Àò€›ô\òYŸHOOHù[»∏†%àà\òŸ[ù
õ›Àò€›ô\òYŸH»Só‘Tê—Sï
àL
_XOè›õ€ô»€\‹”ò[YO^ÿ	‹›[\Àòò[[òŸYô\›[H	‹õ›Àòò[[òŸYò]Z[õY[ùOOHù[»›[\Àõô]]ò[àõ›Àòò[[òŸYò]Z[õY[ùèHNKéNNNNNH»›[\Àô€€Ÿà›[\Àòô[›”õ‹õ_XOû‹\òŸ[ù
õ›Àòò[[òŸYò]Z[õY[ù
_O‹›õ€ôœè€X[€\‹”ò[YO^‹›[\ÀõŸôöX⁄X[ô\›[Oû‹õ›Àò€›ô\òYŸHOOHù[»∏†%àà\òŸ[ù
õ›Àò€›ô\òYŸH»Só‘Tê—Sï
àL
_O‹€X[è›Çà‘‘P“PSQTÀõX\

‹X⁄X[JHOà¬à€€ú›Ÿ[Hõ›Àõ‹ôÀú‹X⁄X[Y\Àôö[ô

][JHOà][Kò€ŸHOOH‹X⁄X[Kò€ŸJN¬à€€ú›ò[YHHŸ[»ò][ Ÿ[ô\›T€›ÀŸ[õõ‹õJHàù[¬à€€ú›^HXŸ[Ÿ[õõ‹õHOOHù[»∏†%ààŸ[õõ‹õHH»¥'Hààò[YHOOHù[»∏†%àà	”X]úõ›[ô
ò[YJ_X¬à€€ú›]HHXŸ[»¥'t-t`à4`t`¥`4/¥.¥.4/Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.ààŸ[õõ‹õHOOHù[»¥'t-t`à4/t/¥`4/4,4`¥.4,¥,4,à4-4,4/t/tbÙaHààŸ[õõ‹õHH»¥'t/¥`4/4,4`¥.4,à4/t-H4-Ù,4-4,4/Hàà	‹‹X⁄X[Kõò[Y_Nà	‹\òŸ[ù
ò[YJ_H0≠»4%t'Ù$Ù(»	Ÿõ‹õX]
Ÿ[ô\›T€› _H4.4-»4/¥,tbt-t,Ù/à4/t/¥`4/4,4`¥.4,¥,	Ÿõ‹õX]
Ÿ[õõ‹õJ_X¬àô]\õà€\‹”ò[YO^‹›[\Àú‹X⁄X[PŸ[HŸ^O^‹‹X⁄X[Kò€Ÿ_H]O^›]_H€ê€X⁄œ^ 
HOà»Ÿ]Ÿ[X›Y⁄Y
õ›Àõ‹ôÀõ⁄Y
N»Ÿ]Ÿ[X›Y‹X⁄X[J‹X⁄X[Kò€ŸJN»Ÿ]Xäõ‹ôÿ[ö^ò][€àäN»_H›[O^ﬁ»òX⁄Ÿ‹õ›[ôà^OOH¥'Hà»àŸNYYå»ààX]€€‹äò[YJK€€‹éà^OOH¥'Hà»àÕçMŸààààŸôôàà_Oû›^O›é¬àJ_Bà€\‹”ò[YO^‹›[\Àù›[Ÿ[H]OH¥)Ù.4`t.Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.K4,Ù-4-H4/t/¥`4/4,4`¥.4,à4,t/¥.Ùc4b4-H4/t`Ù.ÙcÀ4,4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(»4/t-t`àà›[O^ﬁ»òX⁄Ÿ‹õ›[ôàô\õ‘‹X⁄X[P€›[ùà»àÿéŸ»àààÃåNçM»ã€€‹éààŸôôàà_Oûﬁô\õ‘‹X⁄X[P€›[ùO›Çà›èÇàŸ^[ôYX]ö^⁄YOOHõ›Àõ‹ôÀõ⁄Y	âàà€\‹”ò[YO^‹›[\Àõ[ÿö[Q]Z[‘õ›ﬂOè€€‹[è^ÃNOè]à€\‹”ò[YO^‹›[\Àõ[ÿö[T‹X⁄X[Y\ﬂOÇà‘‘P“PSQTÀõX\

‹X⁄X[JHOà¬à€€ú›Ÿ[Hõ›Àõ‹ôÀú‹X⁄X[Y\Àôö[ô

][JHOà][Kò€ŸHOOH‹X⁄X[Kò€ŸJN¬à€€ú›ò[YHHŸ[»ò][ Ÿ[ô\›T€›ÀŸ[õõ‹õJHàù[¬à€€ú›\ÿ‹ö\[€àHXŸ[Ÿ[õõ‹õHOOHù[»¥'t-t`à4-4,4/t/tbÙaHààŸ[õõ‹õHH»¥'t/¥`4/4,4`¥.4,à4/t-H4-Ù,4-4,4/Hààò[YHOOHù[»¥'t-t`à4-4,4/t/tbÙaH4/Ù/à4`t.Ù/¥`¥,4/àà	‹\òŸ[ù
ò[YJ_H0≠»	Ÿõ‹õX]
Ÿ[ô\›T€› _H4.4-»	Ÿõ‹õX]
Ÿ[õõ‹õJ_H4`t.Ù/¥`¥/¥,ò¬àô]\õà]à€\‹”ò[YO^‹›[\Àõ[ÿö[T‹X⁄X[_HŸ^O^‹‹X⁄X[Kò€Ÿ_Oè‹[èû‹‹X⁄X[Kõò[Y_O‹‹[èè›õ€ôœûŸ\ÿ‹ö\[€üO‹›õ€ôœèŸ]èé¬àJ_BàŸ]èè›è›èüO—úòY€Y[ùé¬àJ_Bà›õŸOè›XõOèŸ]èÇà€\‹”ò[YO^‹›[\ÀõX]ö^Y]ŸOèè¥(t,t,4.Ù,4/t`t.4`4/¥,¥,4/t/tbÙ.H4`4-t.t`¥.4/t,»
4`Ù/Ù`4,4,¥.Ù-t/taÙ-t`t.¥.4.JNèÿèà4`t`Ù/4/4,Z[ä4`t.Ù/¥`¥b»4%t'Ù$Ù(ÀÃ	H4/t/¥`4/4,4`¥.4,¥,
H4/Ù/à4.¥,4-¥-4/¥.H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4`H4/Ù/¥.Ù/¥-¥.4`¥-t.Ùc4/tbÙ/4/t/¥`4/4,4`¥.4,¥/¥/0Ì»4`t`Ù/4/4`»Ã	H4ct`¥.4aH4/t/¥`4/4,4`¥.4,¥/¥,à0Â»L	Kà4(t`4-t-4/t-t-H4,4`4.4a4/4-t`¥.4aÙ-t`t.¥/¥-H4/Ù`4/¥a¥-t/t`¥/¥,à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H4/t-H4.4`t/Ù/¥.Ùc4-Ù`Ù-t`¥`tcÀà4'Ù-t`4-t,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/¥-4/t/¥.H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4/t-H4.¥/¥/4/Ù-t/t`t.4`4`Ù-t`à4-4-ta4.4a¥.4`à4-4`4`Ù,Ù/¥.Kà4(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4,t-t-»4/t/¥`4/4,4`¥.4,¥,4.4`t.¥.Ùc¥aÙ-t/tbÀ4/Ù`4/¥/Ù`Ù`t.¥.4-4,4/t/tbÙaH4/t-H4`taÙ.4`¥,4c¥`¥`tc»4/t`Ù.ÙcÙ/4.àè¥'¥a4.4a¥.4,4.Ùc4/tbÙ.H4/Ù/¥.¥,4-Ù,4`¥-t.Ùc4/t-H4.4-Ù/4-t/tdt/Nèÿèà4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4/Ù.Ù,4/t,H4&8†$LŒéH0Ì»å	H0Â»L	Kà4't,4/Ù`4.4/4-t`å	H4/¥,tbt-t,Ù/à4/t/¥`4/4,4`¥.4,¥,8†%4ct`¥/àL	H4,¥bÙ/Ù/¥.Ù/t-t/t.4c»4/Ù.Ù,4/t,à0™Ù(t/Ù-taãà4`H4`t.Ù/¥`¥,4/4.0Æ»4`ÙaÙ.4`¥bÙ,¥,4-t`à4`¥/¥.Ùc4.¥/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4`H4-Ù,4-4,4/t/tbÙ/4/Ù/¥.Ù/¥-¥.4`¥-t.Ùc4/tbÙ/4/t/¥`4/4,4`¥.4,¥/¥/à4%t`t.Ù.4/t/¥`4/4,4`¥.4,à4`4,4,¥-t/H4/t/à4`t.Ù/¥`¥b»4%t'Ù$Ù(»4-t`t`¥c4/Ù`4/¥,¥-t`4c4`¥-H4-4/¥.Ù-¥/t/¥`t`¥c4.4/Ù`4.4,¥cÙ-Ù.¥`»4(t'»4,à4`4,4-Ù-4-t.Ù-Hà0™Ù)4(4'4(8°•4$Ù&4(pÆŒ»4ct`¥/à4/¥`¥-4-t.Ùc4/tbÙ.H4-4.4,4,Ù/t/¥`t`¥.4aÙ-t`t.¥.4.H4`t.Ù`ÙaÙ,4.Kè‹è€\‹”ò[YO^‹›[\ÀõX]ö^[ÿö[R[ùO¥'t,4-¥/4.4`¥-H0™Ù(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.0Æ»4,à4`t`¥`4/¥.¥-H4'4'ã4aÙ`¥/¥,tb»4`Ù,¥.4-4-t`¥c4`4,4-Ù,t.4,¥.¥`»4/Ù/àM4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/è‹Çà€X]ö^õ›‹Àõ[ô›OOH	âà€\‹”ò[YO^‹›[\Àô[\_O¥'4'à4/Ù/à4`¥,4.¥/¥/4`»4/t,4-Ù,¥,4/t.4cà4/t-H4/t,4.t-4-t/tbÀè‹üBà‹ŸX›[€èÇà€XZ[èüBÇà›XàOOHõ‹ôÿ[ö^ò][€àà	âàXZ[à€\‹”ò[YO^‹›[\ÀúYŸ_OÇàŸX›[€à€\‹”ò[YO^‹›[\Àòÿ\ôOÇà]à€\‹”ò[YO^‹›[\Àõ‹ô‘X⁄Ÿ\üOÇà›€ô\ú⁄\›⁄]⁄ò[YO^€›€ô\ú⁄\H€ê⁄[ôŸO^ÿ⁄[ôŸS›€ô\ú⁄\HœÇàXô[¥'Ù/¥.4`t.à4/4-t-4.4a¥.4/t`t.¥/¥.H4/¥`4,Ù,4/t.4-Ù,4a¥.4.]à€\‹”ò[YO^‹›[\Àú›YŸŸ\›[€êõﬁOè[ú]ò[YO^€‹ôÿ[ö^ò][€îŸX\ò⁄Ÿ[X›Y‹ôœÀõò[YHàüH€ê⁄[ôŸO^ ]ô[ù
HOà»Ÿ]‹ôÿ[ö^ò][€îŸX\ò⁄
]ô[ùù\ôŸ]ùò[YJN»Ÿ]Ÿ[X›Y⁄Y
àäN»_HXŸZ€\èH¥'t,4aÙ/t.4`¥-H4,¥,¥/¥-4.4`¥c4/t,4-Ù,¥,4/t.4-Hà]]–€€\]OHõŸôààœÇà€‹ôÿ[ö^ò][€î›YŸŸ\›[€úÀõ[ô›à	âà]à€\‹”ò[YO^‹›[\Àú›YŸŸ\›[€úﬂOû€‹ôÿ[ö^ò][€î›YŸŸ\›[€úÀõX\

‹ô HOàù]€à\OHòù]€ààŸ^O^€‹ôÀõ⁄YH€ê€X⁄œ^ 
HOà»Ÿ]Ÿ[X›Y⁄Y
‹ôÀõ⁄Y
N»Ÿ]‹ôÿ[ö^ò][€îŸX\ò⁄
àäN»_Oè›õ€ôœû€‹ôÀõò[Y_O‹›õ€ôœè‹[èû€‹ôÀò⁄]_O‹‹[èèÿù]€èä_OŸ]èüBàŸ]èè€Xô[Çà‹[à€\‹”ò[YO^‹›[\Àú‹⁄][€üOûÿ›\úô[ù[ô^
»_H4.4-»€‹ôÿ[ö^ò][€îõ›‹Àõ[ô›H0≠»4`t/¥`4`¥.4`4/¥,¥.¥,4/Ù/à4,¥bÙ/Ù/¥.Ù/t-t/t.4cè‹‹[èÇàŸ]èÇà‹ŸX›[€èÇà‹Ÿ[X›Y‹ô»	âàŸX›[€à€\‹”ò[YO^‹›[\Àòÿ\ôOÇà]à€\‹”ò[YO^‹›[\ÀúŸX›[€íXYOè]èèèû‹Ÿ[X›Y‹ôÀõò[Y_O⁄èè¥&8†$LŒéHH4`t.Ù/¥`¥b»4%t'Ù$Ù(»0Ì»0™Ù't/¥`4/4,4`¥.4,à4$¥(t%t$Ù'∞Æ»0Â»L	Kà4'Ù.Ù,4/H4-4.Ùc»4'4'à8†%å	K4a¥-t.Ùc8†%Ã	N»4`t`¥,4`¥`Ù`H4/Ù/¥.¥,4-ÙbÙ,¥,4-t`à4-t,Ù/à4,¥bÙ/Ù/¥.Ù/t-t/t.4-Kè‹èŸ]èÇà]à€\‹”ò[YO^‹›[\Àôúõ\î⁄‹ù›]X›[€úﬂOÇà‹[à€\‹”ò[YO^ÿ	‹›[\Àú›]\ﬂH	»[‹ô”Y]öX‹ Ÿ[X›Y‹ô Kò€€\]H»›[\Àú›]\”Z\‹⁄[ô»à‹ô”Y]öX‹ Ÿ[X›Y‹ô KõYY]‘[à»›[\Àú›]\–€€\]Hà›[\Àú›]\–ô[›ﬂXOû‹›]\ ‹ô”Y]öX‹ Ÿ[X›Y‹ô Kò€›ô\òYŸJ_O‹‹[èÇàŸúõ\ìX]⁄Yà»ù]€à\OHòù]€àà€\‹”ò[YO^‹›[\Àôúõ\î⁄‹ù›]H€ê€X⁄œ^ 
HOà€ì‹[ëúõ\ì[ Ÿ[X›Y‹ôÀõ⁄Y
_O¥'Ù`4/¥,¥-t`4.4`¥c4/¥b4.4,t.¥.4,à4)4(4'4(‹[à\öXKZY[èHùùYHè∏°•œ‹‹[èèÿù]€èÇàà€X[€\‹”ò[YO^‹›[\Àôúõ\ï[õX]⁄YO¥'4'à4/t-H4`t/¥/Ù/¥`t`¥,4,¥.Ù-t/t,4`H4`4,4-Ù-4-t.Ù/¥/à4/Ù/à“Q‹€X[üBàŸ]èÇàŸ]èÇà]à€\‹”ò[YO^‹›[\Àõ‹ô“‹\ﬂOÇà\ùX€Oè›õ€ô»€\‹”ò[YO^‹[ï€ôJ‹ô”Y]öX‹ Ÿ[X›Y‹ô Kò€›ô\òYŸJ_Oû‹\òŸ[ù
‹ô”Y]öX‹ Ÿ[X›Y‹ô Kò€›ô\òYŸJ_O‹›õ€ôœè‹[è¥&8†$LŒéH0≠»4/Ù.Ù,4/Hå	K4a¥-t.ÙcÃ	O‹‹[èè€X[ûŸõ‹õX]
‹ô”Y]öX‹ Ÿ[X›Y‹ô Kô\›T€› _H4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(»4.4-»Ÿõ‹õX]
‹ô”Y]öX‹ Ÿ[X›Y‹ô Kõõ‹õJ_H4/Ù/à4/¥,tbt-t/4`»4/t/¥`4/4,4`¥.4,¥`œ‹€X[èÿ\ùX€OÇà\ùX€Oè›õ€ôœûŸõ‹õX]
‹ô”Y]öX‹ Ÿ[X›Y‹ô Kù\ôŸ]€› _O‹›õ€ôœè‹[è¥(t.Ù/¥`¥/¥,à4/t`Ù-¥/t/à4-4.Ùc»4/Ù.Ù,4/t,‹‹[èè€X[çå	H4/¥,tbt-t,Ù/à4/t/¥`4/4,4`¥.4,¥,4/¥.¥`4`Ù,Ù.Ù-t/t.4-H4,¥,¥-t`4aO‹€X[èÿ\ùX€OÇà\ùX€Oè›õ€ôœûŸõ‹õX]
‹ô”Y]öX‹ Ÿ[X›Y‹ô KôYöX⁄]
_O‹›õ€ôœè‹[è¥'t-H4at,¥,4`¥,4-t`à4-4/à4/Ù.Ù,4/t,‹‹[èè€X[¥/4.4/t.4/4,4.Ùc4/t/¥-H4aÙ.4`t.Ù/à4-4/¥/Ù/¥.Ù/t.4`¥-t.Ùc4/tbÙaH4`t.Ù/¥`¥/¥,à4%t'Ù$Ù(œ‹€X[èÿ\ùX€OÇà\ùX€Oè›õ€ô»€\‹”ò[YO^‹Ÿ[X›Yò[[òŸYÀò]Z[õY[ùOOHù[	âàŸ[X›Yò[[òŸYÀò]Z[õY[ùOOH[ôYö[ôY	âàŸ[X›Yò[[òŸYò]Z[õY[ùèHNKéNNNNNH»›[\Àô€€Ÿà›[\Àòô[›”õ‹õ_Oû‹\òŸ[ù
Ÿ[X›Yò[[òŸYÀò]Z[õY[ùœ»ù[
_O‹›õ€ôœè‹[è¥(t,t,4.Ù,4/t`t.4`4/¥,¥,4/t/t/¥-H4,¥bÙ/Ù/¥.Ù/t-t/t.4-H4a¥-t.Ù.Ã	O‹‹[èè€X[û‹Ÿ[X›Yò[[òŸYÀò]Z[õY[ùOOHù[»¥'t-t`à4/Ù/¥.Ù/tbÙaH4-4,4/t/tbÙaH4.4.Ù.4/Ù`4.4/4-t/t.4/4bÙaH4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.Hàà	‹Ÿ[X›Yò[[òŸYÀúôXX⁄Y€›[ùœ»H4.4-»	‹Ÿ[X›Yò[[òŸYÀô[Y⁄XõP€›[ùœ»H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H4-4/¥`t`¥.4,Ù.Ù.Ã	XO‹€X[èÿ\ùX€OÇàŸ]èÇà‹Ÿ[X›Yò[[òŸYÀò]Z[õY[ùOOHù[	âàŸ[X›Yò[[òŸYÀò]Z[õY[ùOOH[ôYö[ôY	âà€\‹”ò[YO^‹›[\Àòò[[òŸYõ›_Oèè¥&¥/¥/t`¥`4/¥.Ùc4,t,4.Ù,4/t`t,èÿèà4/Ù`4-t,¥bÙb4-t/t.4-H4/Ù/à4/¥`¥-4-t.Ùc4/tbÙ/4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/
Ÿõ‹õX]
Ÿ[X›Yò[[òŸYô^Ÿ\‹‘€› _H4`t.Ù/¥`¥/¥,à4`t,¥-t`4aHÃ	H4.4aH4/t/¥`4/4,4`¥.4,¥,
H4/t-H4.4`t/Ù/¥.Ùc4-Ù`Ù-t`¥`tc»4-4.Ùc»4.¥/¥/4/Ù-t/t`t,4a¥.4.4-4-ta4.4a¥.4`¥,4-4`4`Ù,Ù.4aH4/Ù`4/¥a4.4.Ù-t.Kà4+t`¥/¥`à4/Ù/¥.¥,4-Ù,4`¥-t.Ùc8†%4,¥/t`Ù`¥`4-t/t/t.4.K4/¥a4.4a¥.4,4.Ùc4/tbÙ.H4&8†$LŒéH4.4/Ù.Ù,4/Hå	H4/t-H4.4-Ù/4-t/t-t/tbÀè‹üBàﬁô\õ‘€›‹X⁄X[Y\Àõ[ô›à	âà]à€\‹”ò[YO^‹›[\Àôúõ\ëXY€õ‹›XﬂHõ€OHõõ›HèÇà›õ€ôœ¥'Ù`4/¥,¥-t`4.¥,4`t,¥cÙ-Ù.4$Ù&4(x†$Ù)4(4'4(Ù)4(4'4'à0≠»ﬁô\õ‘€›‹X⁄X[Y\Àõ[ô›H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H4`H4/t`Ù.Ù-t,¥bÙ/4.4`t.Ù/¥`¥,4/4.‹›õ€ôœÇà¥$à4,¥bÙ,Ù`4`Ù-Ù.¥-Hè¥`4,4`tat/¥-¥-4-t/t.4.H4)4(4'4(4/¥`àŸúõ\îò]Àú›[[X\ûKú€›\òŸP›]Oÿèà4/Ù/à4`t/¥/¥`¥,¥-t`¥`t`¥,¥`Ùc¥bt.4/4-4/¥.Ù-¥/t/¥`t`¥cÙ/4-t`t`¥c4/Ù`4/¥,t.Ù-t/4/tbÙ-H4-Ù,4/Ù.4`t.4`»Ÿúõ\ñô\õ‘€›õYŸŸYH4.4-»ﬁô\õ‘€›‹X⁄X[Y\Àõ[ô›H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.Kà4&¥/¥/t.¥`4-t`¥/tbÙ-H4/Ù`4/¥a4.4.Ù.4/¥`¥/4-taÙ-t/tb»4/t.4-¥-Kè‹Çà¥(t,¥-t`4.¥,4)4(4'4'à4/¥`àŸúõ[”[öÿYŸTò]Àò›]NàŸúõ[”‹ôÿ[ö^ò][€ëö[ô[ô‹œÀõX]⁄Yà»úõ[”‹ôÿ[ö^ò][€ëö[ô[ô‹Àö\‹›Y\»OOHù[à»¥.¥/¥.Ù.4aÙ-t`t`¥,¥/à4/¥`¥.¥.Ù/¥/t-t/t.4.H4/Ù/à4/Ù/¥-4`4,4-Ù-4-t.Ù-t/t.4cÙ/4'4'à4/t-H4/¥/Ù`4-t-4-t.Ù-t/t/àÇàà	Ÿúõ[”‹ôÿ[ö^ò][€ëö[ô[ô‹Àö\‹›Y\ﬂH4`t`¥`4/¥.à4`H4/Ù`4.4-Ù/t,4.¥,4/4.4`4,4`tat/¥-¥-4-t/t.4.H4/Ù/à4'4'à4.4-»	Ÿõ‹õX]
úõ[”‹ôÿ[ö^ò][€ëö[ô[ô‹Àúõ›‹ _H4`t`¥`4/¥.òààúõ[”‹ôÿ[ö^ò][€ëö[ô[ô‹œÀò[XöY›[›\¬à»¥/t-t`t.¥/¥.Ùc4.¥/à4`t/¥,¥/Ù,4-4,4c¥bt.4aH4/Ù`4.4,¥cÙ-Ù/¥.à“Q4'4'à8†%4`¥`4-t,t`Ù-t`¥`tc»4/Ù`4/¥,¥-t`4.¥,Çàà¥/t-t`à4/¥-4/t/¥-Ù/t,4aÙ/t/¥,Ù/à4`t/¥/Ù/¥`t`¥,4,¥.Ù-t/t.4c»4'4'à4/Ù/à“QüKè‹Çàèè¥$¥,4-¥/t/éèÿèà4ct`¥.4,¥bÙ,Ù`4`Ù-Ù.¥.4/t-H4`t/¥-4-t`4-¥,4`à4/Ù/¥.Ù/t/¥,Ù/à4`t/Ù.4`t.¥,4,¥`4,4aÙ-t.H4.4/t-H4`Ù`t`¥,4/t,4,¥.Ù.4,¥,4c¥`à4/Ù`4.4aÙ.4/t`»4/¥`¥`t`Ù`¥`t`¥,¥.4c»4`t.Ù/¥`¥/¥,ãà4'Ù`4.4/¥`¥`t`Ù`¥`t`¥,¥.4.4-Ù,4/Ù.4`t-t.H4/Ù/à4-4/¥.Ù-¥/t/¥`t`¥.4/t-t.Ùc4-Ùc»4`taÙ.4`¥,4`¥c4aÙ`¥/à4,¥`4,4a»4/¥`¥`t`Ù`¥`t`¥,¥`Ù-t`ãà4'Ù`4/¥,¥-t`4c4`¥-H4.¥,4-4`4/¥,¥bÙ-H4`t,¥-t-4-t/t.4cÀ4/Ù`4.4,¥cÙ-Ù.¥`»4(t'À4`4,4`t/Ù.4`t,4/t.4-H4'4&4(H4.4-4/¥`t`¥`Ù/Ù/t/¥`t`¥c4`t.Ù/¥`¥/¥,à4/t,4%t'Ù$Ù(Àè‹ÇàŸ]èüBàŸúõ\îô]öY]‘õ›‹Àõ[ô›à	âà€\‹”ò[YO^‹›[\Àò⁄\ùõ›_Oèè¥'Ù`4/¥,¥-t`4.4`¥c4)4(4'4(àŸúõ\îô]öY]‘õ›‹Àõ[ô›H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.Kèÿèà4%t`t`¥c4`t.Ù/¥`¥b»4%t'Ù$Ù(»4/Ù`4.4/t`Ù.Ù-t,¥/¥/4/t/¥`4/4,4`¥.4,¥-Kà4't,4-¥/4.4`¥-H0™Ù'Ù`4/¥,¥-t`4.4`¥c4/¥b4.4,t.¥.4,à4)4(4'4(0Æ»4,¥bÙb4-Nà4/¥`¥.¥`4/¥-t`¥`tc»4.¥,4`4`¥/¥aÙ.¥,4ct`¥/¥.H4'4'à4,à4`4,4-Ù-4-t.Ù-Hà4`H4-4-t`¥,4.Ù.4-Ù,4a¥.4-t.H4-4/¥.Ù-¥/t/¥`t`¥-t.K4(t'»4.4-Ù,4/Ù.4`t-t.Kà4'Ù/¥-4`¥,¥-t`4-¥-4dt/t/tbÙ-H4/¥b4.4,t.¥.4.4`t/Ù`4,4,¥c4`¥-H4,à4/Ù-t`4,¥.4aÙ/t/¥/4.4`t`¥/¥aÙ/t.4.¥-Kà4't`Ù.Ù-t,¥/¥.H4/t/¥`4/4,4`¥.4,à4`t,4/4/Ù/à4`t-t,t-H4/t-H4-4/¥.¥,4-ÙbÙ,¥,4-t`à4/¥b4.4,t.¥`Àè‹üBà]à€\‹”ò[YO^‹›[\ÀúŸX›[€íXYOè]èèè¥'Ù/¥.¥,4-Ù,4`¥-t.Ù.4/Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/⁄èè¥%Ù/t,4aÙ-t/t.4c»4/Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/4`t/Ù`4,4,¥/¥aÙ/tbÙ-Nà4/Ù.Ù,4/Hå	H4/Ù`4.4/4-t/tcÙ-t`¥`tc»4.à4/¥,tbt-t/4`»4/Ù/¥.¥,4-Ù,4`¥-t.Ùcà4'4'ãà4'4-t-4.4,4/t,4`t`4,4,¥/t.4,¥,4-t`à4'4'à4`H4-4`4`Ù,Ù.4/4.4/¥`4,Ù,4/t.4-Ù,4a¥.4cÙ/4.4`¥/¥,Ù/à4-¥-H4/t,4,t/¥`4,4,¥bÙ,Ù`4`Ù-Ù.¥.è‹èŸ]èèŸ[X›€\‹”ò[YO^‹›[\Àö[õ[ôTŸ[X›Hò[YO^‹Ÿ[X›Y‹X⁄X[_H€ê⁄[ôŸO^ ]ô[ù
HOàŸ]Ÿ[X›Y‹X⁄X[J]ô[ùù\ôŸ]ùò[YJ_Oè‹[€àò[YOHàè¥$¥`t-H4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.€‹[€èû‘‘P“PSQTÀõX\

‹X⁄X[JHOà‹[€àŸ^O^‹‹X⁄X[Kò€Ÿ_Hò[YO^‹‹X⁄X[Kò€Ÿ_Oû‹‹X⁄X[Kõò[Y_O€‹[€èä_O‹Ÿ[X›èŸ]èÇà]à€\‹”ò[YO^‹›[\ÀùXõTÿ‹õ€OèXõH€\‹”ò[YO^‹›[\ÀùXõ_OèXYèèè¥(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥c›è¥'t/¥`4/4,4`¥.4,à4$¥(t%t$Ù'è›è¥(t.Ù/¥`¥/¥,à4-4.Ùc»4%t'Ù$Ù(œ›è¥&8†$LŒéK	O›è¥'4-t-4.4,4/t,4,¥bÙ,t/¥`4.¥.	O›è¥'¥`¥.¥.Ù/¥/t-t/t.4-K4/À¥/Àè›è¥'4'à4,à4,¥bÙ,t/¥`4.¥-O›è›èè›XYèõŸOÇàŸ\‹^T‹X⁄X[Y\ÀõX\

õ› HOà¬à€€ú›ô[ò⁄X\ö»Hô[ò⁄X\ö–ûT‹X⁄X[KôŸ]
õ›Àò€ŸJN¬à€€ú›Yôô\ô[òŸHHõ›Àò€›ô\òYŸHOOHù[	âàô[ò⁄X\öœÀõYYX[àOOHù[	âàô[ò⁄X\öœÀõYYX[àOOH[ôYö[ôY»õ›Àò€›ô\òYŸHHô[ò⁄X\öÀõYYX[ààù[¬àô]\õààŸ^O^‹õ›Àò€Ÿ_Oè€\‹”ò[YO^‹›[\Àõ‹ô”ò[Y_Oû‹õ›Àõò[Y_^‹õ›Àõõ‹õHOOHù[	âàõ›Àõõ‹õHà	âàõ›Àô\›T€›»OOH	âà€X[€\‹”ò[YO^‹›[\Àôúõ\í[õ[ôQXY€õ‹›XﬂH]O^Ÿúõ\ñô\õ‘€›\‹›Y\ÀôŸ]
õ›Àò€ŸJOÀúõ€\ÀõX\

ôX€‹ô
HOà	‹ôX€‹ôõò[Y_Nà	‹ôX€‹ôò€›[ùX
Köõ⁄[äé»äH¥'t`Ù.Ù-t,¥,4c»4-Ù,4/Ù.4`tc4`t.Ù/¥`¥/¥,à4`¥`4-t,t`Ù-t`à4/Ù`4/¥,¥-t`4.¥.4'4&4(K4)4(4'4(4.4)4(4'4'àüOû úõ\ñô\õ‘€›\‹›Y\ÀôŸ]
õ›Àò€ŸJOÀò€›[ùœ»
Hà»4)4(4'4(à	Ÿõ‹õX]
úõ\ñô\õ‘€›\‹›Y\ÀôŸ]
õ›Àò€ŸJHKò€›[ù
_H4-Ù,4/Ù.4`t-t.H4`H4`4,4`tat/¥-¥-4-t/t.4cÙ/4.à¥(t,¥cÙ-Ù.¥`»4`H4)4(4'4(Ù)4(4'4'à4/t`Ù-¥/t/à4/Ù`4/¥,¥-t`4.4`¥cüO‹€X[ü^‹õ›Àõõ‹õHOOH	âàõ›Àô\›T€›»OOHù[	âàõ›Àô\›T€›»à	âà€X[›[O^ﬁ»\‹^Nàòõÿ⁄»ã€€‹éààŒNåLNãõ€ùŸZY⁄àÃ_O¥'Ù`4/¥,¥-t`4.4`¥c4)4(4'4(‹€X[üO›èûŸõ‹õX]
õ›Àõõ‹õJ_O›èûŸõ‹õX]
õ›Àô\›T€› _O›è€\‹”ò[YO^ÿ	‹›[\ÀõY]öX–Ÿ[H	‹‹X⁄X[Pò[ô
õ›Àò€›ô\òYŸJ_XOû‹\òŸ[ù
õ›Àò€›ô\òYŸJ_O›èû‹\òŸ[ù
ô[ò⁄X\öœÀõYYX[àœ»ù[
_O›è€\‹”ò[YO^ŸYôô\ô[òŸHOOHù[»›[\Àõô]]ò[àYôô\ô[òŸHèH»›[\Àô€€Ÿà›[\Àòô[›”õ‹õ_OûŸYôô\ô[òŸHOOHù[»∏†%ààûŸYôô\ô[òŸHà»ä»àààü^€ù[Xô\ëõ‹õX]ôõ‹õX]
Yôô\ô[òŸJ_OœüO›èûÿô[ò⁄X\öœÀò€›[ùœ»O›è›èé¬àJ_Bà›õŸOè›XõOèŸ]èÇàŸX›[€à€\‹”ò[YO^‹›[\Àõ‹ô“[ú⁄Y⁄ﬂOÇà\ùX€Oèœ¥'¥`4,Ù,4/t.4-Ù,4a¥.4c»4/¥`¥/t/¥`t.4`¥-t.Ùc4/t/à4,¥bÙ,t/¥`4.¥.⁄œè¥'Ù/à4,¥bÙ,t`4,4/t/tbÙ/4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/4/t.4-¥-H4/4-t-4.4,4/tbŒàèûÿô[›”YYX[ê€›[ùOÿèé»4/t,4`Ù`4/¥,¥/t-H4.4.Ù.4,¥bÙb4-NàèûÿXõ›ôSYYX[ê€›[ùOÿèãè‹èÿ\ùX€OÇà\ùX€Oèœ¥(Ù/Ù`4,4,¥.Ù-t/taÙ-t`t.¥.4.H4,¥bÙ,¥/¥-⁄œè¥(t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥-t.H4`H4`Ù`4/¥,¥/t-t/4/t.4-¥-HçINàèûÿ‹ö]Xÿ[€›[ùOÿèãà4(t,4/4bÙ-H4/t.4-Ù.¥.4-H4-Ù/t,4aÙ-t/t.4cŒà›ŸXZŸ\›‹X⁄X[Y\Àõ[ô›»ŸXZŸ\›‹X⁄X[Y\ÀõX\

õ› HOà	‹õ›Àõò[Y_H8†%	‹\òŸ[ù
õ›Àò€›ô\òYŸJ_X
Köõ⁄[äé»äHà¥/t-t`à4-4,4/t/tbÙaHüKè‹èÿ\ùX€OÇà‹ŸX›[€èÇà]à€\‹”ò[YO^‹›[\Àú‹X⁄X[SYŸ[ôOè‹[èèH€\‹”ò[YO^‹›[\Àú‹X⁄X[Q‹ôY[üHœ∏¢iMÕIH8†%4,¥bÙ`t/¥.¥.4.H4`Ù`4/¥,¥-t/tc‹‹[èè‹[èèH€\‹”ò[YO^‹›[\Àú‹X⁄X[VY[›ﬂHœçL8†$ÕÕ	H8†%4`¥`4-t,t`Ù-t`à4,¥/t.4/4,4/t.4cœ‹‹[èè‹[èèH€\‹”ò[YO^‹›[\Àú‹X⁄X[S‹ò[ôŸ_Hœåçx†$ÕIH8†%4-Ù/¥/t,4`4.4`t.¥,‹‹[èè‹[èèH€\‹”ò[YO^‹›[\Àú‹X⁄X[TôYHœâõÃçIH8†%4.¥`4.4`¥.4aÙ/t/è‹‹[èè‹[è¥)¥,¥-t`¥/¥,¥/¥.H4/¥`4.4-t/t`¥.4`4-4.Ùc»4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.»4/Ù.Ù,4/Hå	H4/¥a¥-t/t.4,¥,4-t`¥`tc»4/Ù/à4'4'à4,à4a¥-t.Ù/¥/è‹‹[èèŸ]èÇà€\‹”ò[YO^‹›[\Àò⁄\ùõ›_O¥'4-t-4.4,4/t,4`4,4`t`taÙ.4`¥,4/t,4/Ù/à4'4'à4`¥/¥.H4-¥-H4,¥bÙ,Ù`4`Ù-Ù.¥.àÿô[ò⁄X\ö”‹ôÿ[ö^ò][€úÀõ[ô›H4/¥`4,Ù,4/t.4-Ù,4a¥.4.H0≠»4`t`4-t-»ÿô[ò⁄X\ö—]\Ÿ]Àúô\‹ù]Hœ»∏†%üKà4$à4,¥bÙ,t/¥`4.¥`»4/Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥.4,¥at/¥-4cÙ`à4'4'à4`H4/Ù/¥.Ù/¥-¥.4`¥-t.Ùc4/tbÙ/4/¥,tbt.4/4/t/¥`4/4,4`¥.4,¥/¥/»4/t`Ù.Ù-t,¥bÙ-H4-Ù/t,4aÙ-t/t.4c»4`t.Ù/¥`¥/¥,à4`ÙaÙ.4`¥bÙ,¥,4c¥`¥`tcÀè‹Çà‹ŸX›[€èüBà€XZ[èüBÇàõ€›\à€\‹”ò[YO^‹›[\Àôõ€›\üO¥&4`t`¥/¥aÙ/t.4.éà4a4/¥`4/4,4&8†$LŒéK4.Ù.4`t`à0™Ù/t/¥`4/4,4`¥.4,¥bÆÀà4(4-t,4.Ùc4/tbÙ.H4/Ù`4/¥a¥-t/t`à4&8†$LŒéHH0™Ù(t.Ù/¥`¥/¥,à4-4.Ùc»4%t'Ù$Ù(Æ»0Ì»0™Ù't/¥`4/4,4`¥.4,à4$¥(t%t$Ù'∞Æ»0Â»L	N»4/Ù.Ù,4/H4.¥,4-¥-4/¥.H4'4'à8†%å	K4a¥-t.Ùc8†%Ã	Kà4't-tat,¥,4`¥.¥,4`4,4`t`taÙ.4`¥bÙ,¥,4-t`¥`tc»4/Ù/à4.¥,4-¥-4/¥.H4'4'à4.¥,4.à4/4.4/t.4/4,4.Ùc4/t/¥-H4a¥-t.Ù/¥-H4aÙ.4`t.Ù/à4-4/¥/Ù/¥.Ù/t.4`¥-t.Ùc4/tbÙaH4`t.Ù/¥`¥/¥,à4-4/àå	H4/¥,tbt-t,Ù/à4/t/¥`4/4,4`¥.4,¥,à0™Ù't/¥`4/4,4-4.Ùc»4%t'Ù$Ù(Æ»4.0™Ù$¥`t-t,Ù/à4`t.Ù/¥`¥/¥,∞Æ»4,à4/¥a¥-t/t.¥-H4/t-H4.4`t/Ù/¥.Ùc4-Ù`Ùc¥`¥`tcŒ»4`t.Ù/¥`¥b»4/Ù/à4`t/Ù-ta¥.4,4.Ùc4/t/¥`t`¥cÙ/4`H4/t`Ù.Ù-t,¥bÙ/4/t/¥`4/4,4`¥.4,¥/¥/4/t-H4,¥at/¥-4cÙ`à4,à4/¥a4.4a¥.4,4.Ùc4/tbÙ.H4.4`¥/¥,»4a4/¥`4/4bÀà4&4`¥/¥,»4/Ù/à4`4-t,Ù.4/¥/t`»8†%4/¥`¥/t/¥b4-t/t.4-H4`t`Ù/4/4b»4`t.Ù/¥`¥/¥,à4.à4`t`Ù/4/4-H4/¥,tbt-t,Ù/à4/t/¥`4/4,4`¥.4,¥,à4%4,4`¥b»4`t`4-t-Ù/¥,éà—UKõX\

]\Ÿ]
HOà]\Ÿ]úô\‹ù]JKöõ⁄[äà0≠»ä_Kà4'Ù/à4/Ù`4,4,¥.4.Ù`»4`4-t/¥`4,Ù,4/t.4-Ù,4a¥.4.4$4.Ùc4/4-t`¥c4-t,¥`t.¥,4.4-»4`¥-t.¥`Ùbt-t,Ù/à4/¥`¥aÙdt`¥,4.4`t.¥.Ùc¥aÙ-t/tb»4/Ù`4-t-¥/t.4-H4'4'ã4,Ù/¥.Ù/¥,¥/t,4c»4/¥`4,Ù,4/t.4-Ù,4a¥.4c»4`t/¥at`4,4/t-t/t,à4'¥`¥`t`Ù`¥`t`¥,¥.4-H4-4,4/t/tbÙaH4/t-H4-Ù,4/4-t/tcÙ-t`¥`tc»4/t`Ù.Ùdt/»4,Ù/¥`t`Ù-4,4`4`t`¥,¥-t/t/tbÙ-KÙaÙ,4`t`¥/tbÙ-H4/¥`4,Ù,4/t.4-Ù,4a¥.4.4`4,4-Ù-4-t.Ù-t/tb»4/Ù/à4/¥`4,Ù,4/t.4-Ù,4a¥.4/¥/t/t/ãt/Ù`4,4,¥/¥,¥/¥.H4a4/¥`4/4-KèŸõ€›\èÇàŸ]èé¬üB