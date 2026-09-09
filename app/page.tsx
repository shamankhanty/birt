"use client";

import { useMemo, useState } from "react";
import moDataRaw from "./mo-data.json";
import moDetailsRaw from "./mo-details.json";
import moDetailOidsRaw from "./mo-detail-oids.json";
import semdSummaryRaw from "./semd-summary.json";
import operationalMoRaw from "./operational-mo.json";
import errorCategoriesRaw from "./error-categories.json";
import errorOrganizationsRaw from "./error-organizations.json";
import monthlyMoRaw from "./monthly-mo.json";
import maxAppointmentsMunicipalRaw from "./max-appointments-municipal.json";
import unitDataRaw from "./unit-data.json";
import organizationStatusRaw from "./organization-status.json";
import moRegistryRaw from "./mo-registry.json";
import electronicWaybillRaw from "./electronic-waybill.json";
import electronicWaybillWeeklyRaw from "./electronic-waybill-weekly.json";
import federalControlRaw from "./federal-control.json";
import hearingSnapshotsRaw from "./hearing-snapshots.json";
import preventiveSemdAuditRaw from "./preventive-semd-audit.json";
import physicianMetricsRaw from "./physician-metrics.json";
import indicatorRegistryRaw from "../config/indicator-registry.json";
import {
  cleanMoName,
  createMoRegistryRuntime,
  moKey,
  reportMoName,
  SPASSK_CRB_ORGANIZATION as spasskCrbOrganization,
  SPASSK_CRB_REPORT_METRICS as spasskCrbReportMetrics,
} from "../lib/mo-registry.js";
import type { MoRegistry, RegistryOrganization } from "../lib/mo-registry.js";
import { createIndicatorRegistryRuntime } from "../lib/indicator-registry.js";
import type { IndicatorRegistryDocument } from "../lib/indicator-registry.js";
import {
  buildFullMonthComparison,
  datasetBelongsToReportingMonth,
  resolveReportingPeriods,
} from "../lib/period-engine.js";
import {
  aggregateComponents,
  aggregateCountRows,
  aggregateQuantityPairs,
  createIndicatorCalculationRuntime,
  parseQuantityPair,
  passedPlan,
  scoreAgainstPlan,
} from "../lib/calculation-engine.js";

type Status = "good" | "warn" | "bad" | "na";

type MaxServiceValue = {
  value: number | null;
  previous: number | null;
  change: number | null;
  share: number | null;
  status: "present" | "zero" | "missing" | "unavailable";
};

type MaxMonthlyRow = {
  name: string;
  tmk: MaxServiceValue;
  eln: MaxServiceValue;
};
type MonthlyMaxSourceRow = {
  name: string;
  june: number | null;
  july: number | null;
  sourceWarning?: string;
};
type MaxAppointmentMunicipalData = {
  name: string;
  source: string;
  dimension: "municipality";
  bindingToMedicalOrganization: false;
  note: string;
  months: Array<{ id: string; label: string; complete: boolean }>;
  totals: Record<string, number>;
  grandTotal: number;
  rows: Array<{
    municipality: string;
    values: Record<string, number | null>;
    total: number;
  }>;
};

type FederalControlRow = {
  id: string;
  type: string;
  name: string;
  plan: string;
  federal: string;
  status: string;
  regionalId?: string;
  regionalFact?: string;
  regionalPeriod?: string;
  sourceNote?: string;
  regionalManualStatus?: "achieved" | "notAchieved" | "reference";
};

function federalPeriodType(row: FederalControlRow) {
  if (/^1\.(?:5|6|7|8|9|10|11|12|13)$/.test(row.id))
    return "За полный календарный месяц";
  if (
    row.plan === "Да" ||
    /^(?:Да|Нет)$/.test(row.federal.trim()) ||
    /Автоматизирован|Интеграц|Использование витрины/.test(row.name)
  )
    return "Состояние на отчётную дату";
  return "Накопительный с начала года";
}
type FederalControlData = {
  source: string;
  federalPeriod: string;
  collegiumRegionalSource?: string;
  agreement: FederalControlRow[];
  collegium: FederalControlRow[];
};
const DASHBOARD_VERSION = "5.2.5";
const indicatorRegistry = createIndicatorRegistryRuntime(
  indicatorRegistryRaw as IndicatorRegistryDocument,
);
type UnifiedRow = {
  key: string;
  name: string;
  scope: "РФ" | "РТ" | "РФ и РТ";
  federal?: FederalControlRow;
  regionalId?: string;
};
type ExtendedCategory =
  | "all"
  | "integration"
  | "services"
  | "documents"
  | "transfer"
  | "doctors"
  | "medicines"
  | "ai";
type ExtendedStatus =
  | "all"
  | "exceptContract"
  | "achieved"
  | "notAchieved"
  | "contract"
  | "noData";
type ExtendedCardItem = {
  key: string;
  row: FederalControlRow;
  source: "agreement" | "collegium";
  collegium?: FederalControlRow;
};
const federalControl = federalControlRaw as FederalControlData;
type PreventiveAuditRow = {
  name: string;
  oid: string;
  child: boolean;
  semd122: number | null;
  semd228: number | null;
  selected: number | null;
  selectedType: string | null;
  foms: number | null;
  share: number | null;
  oldShare: number | null;
  change: number | null;
  issues: string[];
};
type PreventiveAuditData = {
  summary: {
    status: "ready" | "blocked";
    year: number;
    formula: string;
    period122: string | null;
    period228: string | null;
    source122: string | null;
    source228: string;
    organizations: number;
    changed: number;
    changedChildren: number;
    over100: number;
    zeroDenominatorWithSemd: number;
    missing: number;
    childrenMissing?: boolean;
    childOrganizations?: number;
    numerator?: number;
    denominator?: number;
    share?: number;
    selected122?: number;
    selected228?: number;
    selectedEqual?: number;
  };
  rows: PreventiveAuditRow[];
};
const preventiveSemdAudit = preventiveSemdAuditRaw as PreventiveAuditData;
const preventiveChildOids = new Set(
  preventiveSemdAudit.rows.filter((row) => row.child).map((row) => row.oid),
);
// Августовский расчёт СЭМД 122/228 включает взрослые и детские МО.
const blockedIndicatorIds = new Set<string>();

type Indicator = {
  id: string;
  group: string;
  name: string;
  fact: number;
  plan: number | null;
  unit: string;
  trend: number | null;
  date: string;
  lag: number | null;
  reverse?: boolean;
  quantity?: number;
  quantityLabel?: string;
  compareTo?: string;
  provisional?: boolean;
  planPeriod?: string;
  periodKind?: "monthly" | "cumulative" | "operational" | "snapshot";
};
const baselineIndicators: Indicator[] = [
  {
    id: "egpu",
    group: "Цифровые сервисы",
    name: "Доля заявлений о прикреплении на ЕПГУ",
    fact: 98.02,
    plan: null,
    unit: "%",
    trend: null,
    date: "07.09.2026",
    lag: 624,
    quantity: 30850,
    quantityLabel: "из 31 474 поданных заявлений",
    compareTo: "28.08.2026",
  },
  {
    id: "egpu2days",
    group: "Цифровые сервисы",
    name: "Доля заявлений о прикреплении на ЕПГУ, рассмотренных за 2 рабочих дня",
    fact: 81.51,
    plan: null,
    unit: "%",
    trend: 0.45,
    date: "07.09.2026",
    lag: 5820,
    quantity: 25654,
    quantityLabel: "из 31 474 поданных заявлений",
    compareTo: "28.08.2026",
  },
  {
    id: "birth",
    group: "СЭМД",
    name: "МСР",
    fact: 99.42,
    plan: null,
    unit: "%",
    trend: -0.17,
    date: "07.09.2026",
    lag: 128,
    quantity: 21904,
    quantityLabel: "из 22 032 свидетельств",
    compareTo: "28.08.2026",
  },
  {
    id: "death",
    group: "СЭМД",
    name: "МСС",
    fact: 98.63,
    plan: null,
    unit: "%",
    trend: 0.05,
    date: "07.09.2026",
    lag: 384,
    quantity: 27727,
    quantityLabel: "из 28 111 свидетельств",
    compareTo: "28.08.2026",
  },
  {
    id: "semd228",
    group: "Профилактика",
    name: "Доля СЭМД (122/228) профилактического осмотра (диспансеризации)",
    fact: 76.45,
    plan: null,
    unit: "%",
    trend: 1.19,
    date: "07.09.2026",
    lag: 479581,
    quantity: 1557278,
    quantityLabel: "из 2 036 859 обращений ФОМС · взрослые и детские МО · MAX СЭМД 122/228 по каждой МО",
    compareTo: "31.08.2026",
  },
  {
    id: "hospital",
    group: "СЭМД",
    name: "Доля СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома» относительно количества случаев",
    fact: 83.94,
    plan: null,
    unit: "%",
    trend: 7.0,
    date: "07.09.2026",
    lag: 98382,
    quantity: 514249,
    quantityLabel: "из 612 631 случая",
    compareTo: "29.08.2026",
  },
  {
    id: "ambulatoryCase",
    group: "СЭМД",
    name: "Доля СЭМД «Эпикриз по законченному случаю амбулаторный» (СЭМД №92, №233) относительно количества случаев",
    fact: 87.22,
    plan: null,
    unit: "%",
    trend: 2.1,
    date: "29.08.2026",
    lag: 1399329,
    quantity: 9549272,
    quantityLabel: "из 10 948 601 амбулаторного случая",
    compareTo: "21.08.2026",
  },
  {
    id: "elmk",
    group: "СЭМД",
    name: "Доля МО, обеспечивших передачу СЭМД «Медицинское заключение по результатам медицинского осмотра для предоставления в подсистему ЭЛМК» в РЭМД ЕГИСЗ",
    fact: 95.95,
    plan: null,
    unit: "%",
    trend: 5.41,
    date: "07.09.2026",
    lag: 3,
    quantity: 71,
    quantityLabel: "из 74 медицинских организаций",
    compareTo: "28.08.2026",
  },
  {
    id: "oncologyCouncil",
    group: "СЭМД",
    name: "Доля МО II и III уровня с подразделениями онкологического профиля, формирующих СЭМД «Протокол консилиума врачей онкологического»",
    fact: 50,
    plan: null,
    unit: "%",
    trend: null,
    date: "30.06.2026",
    lag: 1,
    provisional: true,
  },
  {
    id: "tvspStationary",
    group: "ТВСП",
    name: "Доля ТВСП, передающих СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома»",
    fact: 98.91,
    plan: null,
    unit: "%",
    trend: 0,
    date: "07.09.2026",
    lag: 3,
    quantity: 272,
    quantityLabel: "из 275 ТВСП",
    compareTo: "31.08.2026",
  },
  {
    id: "tvspAmbulatory",
    group: "ТВСП",
    name: "Доля амбулаторных ТВСП, передающих СЭМД «Эпикриз по законченному случаю амбулаторный» («Талон амбулаторного пациента») и/или «Протокол консультации»",
    fact: 100,
    plan: null,
    unit: "%",
    trend: 0.22,
    date: "07.09.2026",
    lag: 0,
    quantity: 461,
    quantityLabel: "из 461 ТВСП",
    compareTo: "31.08.2026",
  },
  {
    id: "tvspLaboratory",
    group: "ТВСП",
    name: "Доля КДЛ, передающих СЭМД «Протокол лабораторного исследования»",
    fact: 96.83,
    plan: null,
    unit: "%",
    trend: -0.02,
    date: "07.09.2026",
    lag: 4,
    quantity: 122,
    quantityLabel: "из 126 лабораторий",
    compareTo: "31.08.2026",
  },
  {
    id: "tvspDiagnostic",
    group: "ТВСП",
    name: "Доля ТВСП, передающих СЭМД «Протокол диагностических исследований»",
    fact: 98.68,
    plan: null,
    unit: "%",
    trend: 0.32,
    date: "07.09.2026",
    lag: 4,
    quantity: 300,
    quantityLabel: "из 304 ТВСП",
    compareTo: "31.08.2026",
  },
  {
    id: "smpFederal",
    group: "ТВСП",
    name: "Доля станций и подстанций СМП, передающих СЭМД «Карта вызова скорой медицинской помощи»",
    fact: 100,
    plan: null,
    unit: "%",
    trend: 1.45,
    date: "07.09.2026",
    lag: 0,
    quantity: 68,
    quantityLabel: "из 68 станций и подстанций",
    compareTo: "31.08.2026",
  },
  {
    id: "tmkRemd",
    group: "ТВСП",
    name: "Доля МО, обеспечивших передачу СЭМД «Протокол телемедицинской консультации» в РЭМД ЕГИСЗ",
    fact: 97.5,
    plan: null,
    unit: "%",
    trend: 0,
    date: "07.09.2026",
    lag: 1,
    quantity: 39,
    quantityLabel: "из 40 медицинских организаций",
    compareTo: "17.08.2026",
  },
  {
    id: "smp",
    group: "Скорая помощь",
    name: "Доля СЭМД «Карта вызова скорой медицинской помощи» относительно количества случаев скорой помощи",
    fact: 92.31,
    plan: null,
    unit: "%",
    trend: 10.41,
    date: "28.08.2026",
    lag: 47979,
    quantity: 576237,
    quantityLabel: "из 624 216 карт вызова",
    compareTo: "20.08.2026",
  },
  {
    id: "errors",
    group: "Качество",
    name: "Количество ошибок регистрации СЭМД за август",
    fact: 785939,
    plan: null,
    unit: "",
    trend: null,
    date: "31.08.2026",
    lag: null,
  },
  {
    id: "tmkMax",
    group: "МАХ",
    name: "Количество ТМК посредством МАХ",
    fact: 20942,
    plan: null,
    unit: "",
    trend: null,
    date: "07.09.2026",
    lag: null,
  },
  {
    id: "elnMax",
    group: "МАХ",
    name: "Количество ЛВН, закрытых после ТМК посредством МАХ",
    fact: 35948,
    plan: null,
    unit: "",
    trend: null,
    date: "07.09.2026",
    lag: null,
  },
  {
    id: "visitMax",
    group: "МАХ",
    name: "Количество записей к врачу на телеконсультацию посредством МАХ",
    fact: 253169,
    plan: null,
    unit: "",
    trend: null,
    date: "07.09.2026",
    lag: null,
  },
];
const indicators = indicatorRegistry.applyToStaticIndicators(
  baselineIndicators,
) as Indicator[];

type MoRow = {
  name: string;
  fact: number;
  previous: number | null;
  trend: number | null;
  count?: number | null;
  volume?: number | null;
  oid?: string;
  sourceWarning?: string;
  attentionFact?: number;
  overdueVolume?: number;
  overdueRegistered?: number;
  gracePending?: number;
};
type MonthlyMoRow = {
  name: string;
  june: number | null;
  july: number | null;
  change: number | null;
  juneQuantity: string | null;
  julyQuantity: string | null;
};
type MonthlyMoDataset = {
  unit: "%" | "count";
  previousLabel?: string;
  currentLabel?: string;
  rows: MonthlyMoRow[];
};
type MoSortKey =
  | "name"
  | "quantity"
  | "fact"
  | "deviation"
  | "trend"
  | "status"
  | "current"
  | "previous";
type SortDirection = "asc" | "desc";
type MoDataset = {
  name: string;
  plan: number | null;
  unit: string;
  date: string;
  mode?: "count" | "presence";
  direction?: "lower";
  period?: string;
  periodKind?: "monthly" | "cumulative" | "operational" | "snapshot";
  note?: string;
  rows: MoRow[];
};
type PhysicianMetricDataset = MoDataset & {
  periodType: "month";
  specialty?: string;
  summary: { numerator: number; denominator: number; fact: number };
};
type PhysicianMetricsData = {
  source: string;
  formed: string;
  period: string;
  quality: {
    allMoRows: number;
    specialtyRows: number;
    allMoOids: number;
    specialtyMoOids: number;
    unmatchedOids: number;
    categoryErrors: number;
  };
  datasets: Record<string, PhysicianMetricDataset>;
};
const physicianMetricsSource = physicianMetricsRaw as PhysicianMetricsData;
const physicianMetrics = {
  ...physicianMetricsSource,
  datasets: indicatorRegistry.applyToDatasetMap(
    physicianMetricsSource.datasets,
  ),
} as PhysicianMetricsData;
const moData = indicatorRegistry.applyToDatasetMap({
  ...(moDataRaw as Record<string, MoDataset>),
  ...(operationalMoRaw as Record<string, MoDataset>),
  ...(organizationStatusRaw as Record<string, MoDataset>),
  ...(physicianMetrics.datasets as Record<string, MoDataset>),
}) as Record<string, MoDataset>;
moData.tvspDiagnostic.note =
  moRegistryRaw.diagnosticDenominatorDecision.message;
if (preventiveSemdAudit.summary.status === "blocked") {
  moData.semd228 = {
    ...moData.semd228,
    note: "Временное правило: взрослые МО оцениваются по имеющемуся СЭМД 228. Детские МО не оцениваются до загрузки СЭМД 122 и не включаются в антилидеров, рейтинг и приоритет заслушивания.",
    rows: moData.semd228.rows.map((row) =>
      preventiveChildOids.has(row.oid ?? "")
        ? {
            ...row,
            previous: null,
            trend: null,
            sourceWarning:
              "Нет данных для корректного расчёта детской МО: ожидается СЭМД 122. Значение СЭМД 228 показано отдельно справочно.",
          }
        : {
            ...row,
            sourceWarning:
              "Временная оценка взрослой МО по СЭМД 228 до загрузки СЭМД 122.",
          },
    ),
  };
}
type UnitRow = {
  mo: string;
  moOid: string;
  unit: string;
  unitOid: string;
  buildingIds: string;
  registered: boolean;
  partial?: boolean;
  count: number;
  plannedSubunits?: number;
  registeredSubunits?: number;
};
type UnitDataset = {
  name: string;
  entity: string;
  plan: number;
  fact: number;
  date: string;
  rows: UnitRow[];
};
const unitData = unitDataRaw as Record<string, UnitDataset>;
const moRegistry = moRegistryRaw as MoRegistry;
const {
  byOid: registryByOid,
  organizationForMetric: registryOrganizationForMetric,
  organizationByMetricAndName: registryOrganizationByMetricAndName,
} = createMoRegistryRuntime(moRegistry);
const monthlyMoData = monthlyMoRaw as Record<string, MonthlyMoDataset>;
const maxAppointmentsMunicipal = maxAppointmentsMunicipalRaw as MaxAppointmentMunicipalData;

function buildAugustMaxRows(): MaxMonthlyRow[] {
  const tmkRows = (monthlyMoData.tmkMaxCount?.rows ?? []) as MonthlyMaxSourceRow[];
  const elnRows = (monthlyMoData.elnMaxCount?.rows ?? []) as MonthlyMaxSourceRow[];
  const byName = new Map<string, { name: string; tmk?: MonthlyMaxSourceRow; eln?: MonthlyMaxSourceRow }>();
  for (const row of tmkRows) byName.set(moKey(row.name), { name: row.name, tmk: row });
  for (const row of elnRows) {
    const key = moKey(row.name);
    byName.set(key, { ...(byName.get(key) ?? { name: row.name }), eln: row });
  }
  const monthlyValue = (row?: MonthlyMaxSourceRow): MaxServiceValue => {
    if (!row) return { value: null, previous: null, change: null, share: null, status: "missing" };
    if (row.june == null || row.july == null)
      return { value: null, previous: null, change: null, share: null, status: "unavailable" };
    const value = row.july - row.june;
    return { value, previous: null, change: null, share: null, status: value === 0 ? "zero" : "present" };
  };
  const rows = [...byName.values()]
    .filter((row) => !isMaxProfileInapplicable(row.name))
    .map((row) => ({
      name: cleanMoName(row.name),
      tmk: monthlyValue(row.tmk),
      eln: monthlyValue(row.eln),
    }));
  const tmkTotal = rows.reduce((sum, row) => sum + (row.tmk.value ?? 0), 0);
  const elnTotal = rows.reduce((sum, row) => sum + (row.eln.value ?? 0), 0);
  return rows.map((row) => ({
    ...row,
    tmk: { ...row.tmk, share: row.tmk.value != null && tmkTotal ? (row.tmk.value / tmkTotal) * 100 : null },
    eln: { ...row.eln, share: row.eln.value != null && elnTotal ? (row.eln.value / elnTotal) * 100 : null },
  }));
}

const augustMaxRows = buildAugustMaxRows();
const augustMaxTotals = {
  tmk: augustMaxRows.reduce((sum, row) => sum + (row.tmk.value ?? 0), 0),
  eln: augustMaxRows.reduce((sum, row) => sum + (row.eln.value ?? 0), 0),
};
const reportingPeriods = resolveReportingPeriods({
  monthlyDatasets: monthlyMoData,
  datasets: [...Object.values(moData), ...indicators],
  physicianMetrics,
});
const latestFullMonth = reportingPeriods.latestFullMonth;
const previousFullMonth = reportingPeriods.previousFullMonth;
const latestMonthName = latestFullMonth.label.replace(/\s+\d{4}$/u, "");
const previousMonthName = previousFullMonth.label.replace(/\s+\d{4}$/u, "");
const previousMonthDative = previousFullMonth.dative.replace(/\s+\d{4}$/u, "");
const previousMonthInstrumental = previousFullMonth.instrumental.replace(/\s+\d{4}$/u, "");
const latestMonthGenitive = latestFullMonth.genitive.replace(/\s+\d{4}$/u, "");
const ratingPeriodShort = `${latestFullMonth.startDate.slice(0, 5)}–${latestFullMonth.endDate.slice(0, 5)}`;
type MoDetail = { volume: number; registered: number };
const moDetails = moDetailsRaw as Record<string, Record<string, MoDetail>>;
const moDetailOids = moDetailOidsRaw as Record<
  string,
  Record<string, MoDetail>
>;
const sourceBackedIndicatorIds = new Set([
  "egpu",
  "egpu2days",
  "birth",
  "death",
  "semd228",
  "hospital",
  "ambulatoryCase",
  "smp",
]);
const sourceQuantityNouns: Record<string, string> = {
  egpu: "поданных заявлений",
  egpu2days: "поданных заявлений",
  birth: "свидетельств",
  death: "свидетельств",
  semd228: "обращений",
  hospital: "случаев",
  ambulatoryCase: "амбулаторных случаев",
  smp: "карт вызова",
  tvspStationary: "ТВСП",
  tvspAmbulatory: "ТВСП",
  tvspLaboratory: "лабораторий",
  tvspDiagnostic: "ТВСП",
  smpFederal: "станций и подстанций",
};
// Региональное значение каждого показателя рассчитывается один раз в
// deterministic calculation layer и затем переиспользуется всеми разделами.
const calculationRuntime = createIndicatorCalculationRuntime({
  staticIndicators: indicators,
  physicianMetrics,
  moData,
  moDetails,
  moDetailOids,
  preventiveSemdAudit,
  preventiveChildOids,
  blockedIndicatorIds,
  sourceBackedIndicatorIds,
  sourceQuantityNouns,
  reportingLabel: latestFullMonth.label,
  includeDatasetRow: (id: string, row: MoRow) =>
    !isTechnicalRow(row.name) &&
    !isExcludedFromIndicators(row.name) &&
    (!indicatorRegistry.hasRowExclusion(id, "max_profile_inapplicable") ||
      !isMaxProfileInapplicable(row.name)),
});
const liveIndicators = calculationRuntime.indicators as Indicator[];
const calculatedIndicatorById = calculationRuntime.allById as Record<string, Indicator>;

type WaybillComponent = {
  name: string;
  vehicles: number;
  ambulanceVehicles: number;
  otherVehicles: number;
  moved: number;
  movementShare: number | null;
  drivers: number;
  mechanics: number;
  medics: number;
  waybills: number;
  ambulanceWaybills: number;
  otherWaybills: number;
  driversWithWaybills: number;
};
type WaybillRow = {
  sourceNumber: number;
  name: string;
  vehicles: number;
  ambulanceVehicles: number;
  otherVehicles: number;
  moved: number;
  movementShare: number | null;
  drivers: number;
  mechanics: number;
  medics: number;
  waybills: number;
  ambulanceWaybills: number;
  otherWaybills: number;
  driversWithWaybills: number;
  components?: WaybillComponent[];
};
type WaybillSortKey =
  | "name"
  | "vehicles"
  | "moved"
  | "movementShare"
  | "weekDelta"
  | "waybills"
  | "driversWithWaybills"
  | "status";
type ElectronicWaybillData = {
  title: string;
  source: string;
  period: string;
  formed: string | null;
  plan: number | null;
  summary: {
    organizations: number;
    vehicles: number;
    vehiclesWithWaybills: number;
    vehiclesWithWaybillsShare: number;
    vehiclesWithMovement: number;
    vehiclesWithMovementShare: number;
    ambulanceVehicles: number;
    ambulanceVehiclesWithWaybills: number;
    ambulanceVehiclesWithWaybillsShare: number;
    ambulanceVehiclesWithMovement: number;
    ambulanceVehiclesWithMovementShare: number;
    kazanAmbulanceVehicles: number;
    kazanAmbulanceVehiclesWithWaybills: number;
    kazanAmbulanceVehiclesWithWaybillsShare: number;
    kazanAmbulanceVehiclesWithMovement: number;
    kazanAmbulanceVehiclesWithMovementShare: number;
    otherVehicles: number;
    otherVehiclesWithWaybills: number;
    otherVehiclesWithWaybillsShare: number;
    otherVehiclesWithMovement: number;
    otherVehiclesWithMovementShare: number;
  };
  detail: {
    organizations: number;
    vehicles: number;
    vehiclesWithMovement: number;
    waybills: number;
    driversWithWaybills: number;
    zeroMovementOrganizations: number;
    zeroVehicleOrganizations: number;
  };
  quality: {
    field: string;
    summary: number;
    detail: number;
    difference: number;
    note: string;
  }[];
  rows: WaybillRow[];
};
const electronicWaybill = electronicWaybillRaw as ElectronicWaybillData;
type WeeklyWaybillSlice = {
  source: string;
  period: string;
  sourceHeading: string;
  systemSummary: {
    organizations: number;
    vehicles: number;
    vehiclesWithWaybills: number;
    vehiclesWithMovement: number;
  };
  detail: {
    organizations: number;
    vehicles: number;
    vehiclesWithMovement: number;
    movementShare: number;
    waybills: number;
    driversWithWaybills: number;
    organizationsWithMovement: number;
    zeroMovementOrganizations: number;
    zeroVehicleOrganizations: number;
  };
  rows: WaybillRow[];
};
type WeeklyWaybillData = {
  previous: WeeklyWaybillSlice;
  current: WeeklyWaybillSlice;
  comparisonRule: string;
  periodCorrection: string;
};
const electronicWaybillWeekly = electronicWaybillWeeklyRaw as WeeklyWaybillData;
type SemdItem = { name: string; count: number; format: string };
const semdSummary = semdSummaryRaw as {
  period: string;
  formed: string;
  total: number;
  registeredTypes: number;
  items: SemdItem[];
};
const currentSemdTotal = {
  value: semdSummary.total,
  types: semdSummary.registeredTypes,
  date: semdSummary.formed,
};
type ErrorCategoryItem = { name: string; count: number };
type ErrorOrganization = {
  key: string;
  oid: string | null;
  name: string;
  sourceName?: string | null;
  count: number;
  topCategories: ErrorCategoryItem[];
  categories: ErrorCategoryItem[];
};
type ErrorOrganizationBreakdown = {
  status: "available";
  sourcePeriod: string;
  totalErrors: number;
  attributedErrors: number;
  unassignedErrors: number;
  coveragePercent: number;
  sourceRows?: number;
  attributedRows?: number;
  organizationCount: number;
  organizations: ErrorOrganization[];
  unassignedCategories: ErrorCategoryItem[];
};
const errorCategories = errorCategoriesRaw as {
  total: number;
  period: string;
  items: ErrorCategoryItem[];
  organizationBreakdown?: ErrorOrganizationBreakdown;
};
errorCategories.organizationBreakdown =
  errorOrganizationsRaw as ErrorOrganizationBreakdown;
const operational = [
  {
    title: "Заявления через ЕПГУ, обработанные за 2 рабочих дня",
    value: 24533,
    period: "01.01–31.08.2026",
    note: "81,07% от 30 260 заявлений · 29 814 получили финальный статус",
    accent: "green",
  },
  {
    title: "ТМК посредством МАХ",
    value: 103940,
    period: "на 07.09.2026",
    note: "План 193 000 на 2026 год · 77 629 ЛВН при плане 99 000 · оперативные данные РТ",
    accent: "blue",
  },
  {
    title: "Случаи краткого ввода",
    value: 694560,
    period: "01.01–07.09.2026",
    note: "685 066 — амбулаторный блок и профилактика · 9 494 — стационарный блок",
    accent: "amber",
  },
  {
    title: "Госпитализации",
    value: 611601,
    period: "01.01–31.08.2026",
    note: "474 161 выписной СЭМД · 77,53% от случаев · полный август, знаменатель листа 3",
    accent: "blue",
  },
  {
    title: "ФАП и ФП: регистрация СЭМД",
    value: 2868210,
    period: "01.01–07.09.2026",
    note: "Управленческий периметр МО; отсутствие строки не заменяется нулём",
    accent: "green",
  },
  {
    title: "Ошибки регистрации СЭМД",
    value: 10489964,
    period: "01.01–07.09.2026",
    note: "Количество отказов; доля не пересчитана без знаменателя всех запросов",
    accent: "red",
  },
];
const extendedOperational = [
  ...operational.filter(
    (item) =>
      item.title !== "Заявления через ЕПГУ, обработанные за 2 рабочих дня" &&
      item.title !== "ТМК посредством МАХ",
  ),
  {
    title: "Всего зарегистрировано СЭМД",
    value: semdSummary.total,
    period: semdSummary.period,
    note: `${semdSummary.registeredTypes} видов с зарегистрированными документами · сформировано ${semdSummary.formed}`,
    accent: "green",
  },
];

type Guidance = {
  goal: string;
  actions: string[];
  owner: string;
  cadence: string;
  caution?: string;
};
const guidance: Record<string, Guidance> = {
  egpu: {
    goal: "Направить гражданину финальный статус по каждому заявлению о прикреплении.",
    actions: [
      "Ежедневно выгружать заявления без финального статуса.",
      "Разбирать отклонённые и зависшие заявления.",
      "Устранять ошибки маршрутизации и контролировать повторную обработку.",
    ],
    owner: "заместитель главного врача по цифровизации, регистратура",
    cadence: "ежедневно",
  },
  egpu2days: {
    goal: "Рассмотреть каждое заявление о прикреплении не позднее 2 дней.",
    actions: [
      "Ежедневно контролировать заявления старше одного дня.",
      "Закрепить основного и замещающего ответственного.",
      "Перераспределять очередь при риске нарушения контрольного срока.",
    ],
    owner: "заместитель главного врача по цифровизации, регистратура",
    cadence: "ежедневно",
  },
  birth: {
    goal: "Зарегистрировать в РЭМД каждое оформленное медицинское свидетельство о рождении.",
    actions: [
      "Сопоставлять оформленные свидетельства и зарегистрированные СЭМД.",
      "Исправлять отказы подписи, справочников и данных сотрудника.",
      "Повторно отправлять исправленные документы в день выявления.",
    ],
    owner: "родильное подразделение, служба цифровизации",
    cadence: "ежедневно",
  },
  death: {
    goal: "Зарегистрировать в РЭМД каждое оформленное медицинское свидетельство о смерти.",
    actions: [
      "Сверять число свидетельств с регистрацией в РЭМД.",
      "Выделять документы без регистрации и причину отказа.",
      "Контролировать повторную отправку после исправления.",
    ],
    owner: "ответственный за свидетельства, служба цифровизации",
    cadence: "ежедневно",
  },
  semd228: {
    goal: "В 2026 году обеспечивать регистрацию применимого СЭМД 122 или 228 по завершённым профилактическим случаям.",
    actions: [
      "Сопоставлять обращения ФОМС с зарегистрированными СЭМД 122 и 228 за один период.",
      "Для контроля выбирать большее из двух значений отдельно по каждой МО, не суммировать документы.",
      "Проверить переход на СЭМД 228 к 01.01.2027.",
    ],
    owner: "заместитель по поликлинике, служба цифровизации",
    cadence: "ежедневно",
  },
  hospital: {
    goal: "Передавать выписной эпикриз по каждому завершённому случаю госпитализации.",
    actions: [
      "Проверять наличие эпикриза до закрытия истории болезни.",
      "Отдельно контролировать стационар и родильный дом.",
      "Сопоставлять госпитализации, зарегистрированные СЭМД и отказы.",
    ],
    owner: "заместитель по медицинской части, служба цифровизации",
    cadence: "ежедневно",
  },
  ambulatoryCase: {
    goal: "Формировать СЭМД после закрытия каждого амбулаторного случая.",
    actions: [
      "Проверить настройку автоматического формирования документа.",
      "Контролировать подписание врачом и регистрацию в РЭМД.",
      "Разбирать подразделения с наибольшим разрывом между случаями и СЭМД.",
    ],
    owner: "заместитель по поликлинике, служба цифровизации",
    cadence: "ежедневно",
  },
  elmk: {
    goal: "Обеспечить передачу требуемых СЭМД для электронной медицинской книжки.",
    actions: [
      "Проверить лицензированные МО и виды документов.",
      "Устранить нулевые результаты и ошибки регистрации.",
      "Контролировать полноту передачи по каждой МО.",
    ],
    owner: "служба цифровизации, ответственный за профосмотры",
    cadence: "еженедельно",
  },
  oncologyCouncil: {
    goal: "Формировать и регистрировать протокол онкологического консилиума в каждой МО, входящей в плановый перечень.",
    actions: [
      "Проверить актуальность онкологических подразделений в ФРМО.",
      "Настроить формирование и подписание СЭМД после консилиума.",
      "Провести тестовую регистрацию в МО с нулевым результатом.",
    ],
    owner:
      "заместитель по медицинской части, онкологическая служба, служба цифровизации",
    cadence: "ежемесячно",
    caution:
      "В презентации указан срез за январь–июнь; для актуализации нужен новый федеральный отчёт.",
  },
  tvspStationary: {
    goal: "Обеспечить передачу из каждого планового стационарного подразделения.",
    actions: [
      "Проверить перечень ТВСП и OID подразделений.",
      "Найти подразделения без передачи и выполнить тестовую отправку.",
      "Устранить ошибки интеграции и электронной подписи.",
    ],
    owner: "служба цифровизации, руководители стационаров",
    cadence: "еженедельно",
  },
  tvspAmbulatory: {
    goal: "Обеспечить передачу из каждого планового амбулаторного подразделения.",
    actions: [
      "Сверить федеральный перечень ТВСП с фактической структурой МО.",
      "Проверить передачу всех требуемых видов документов.",
      "Исправить OID, маршрутизацию и настройки МИС для нулевых ТВСП.",
    ],
    owner: "служба цифровизации, руководители поликлиник",
    cadence: "еженедельно",
  },
  tvspLaboratory: {
    goal: "Обеспечить передачу протоколов из каждой плановой КДЛ.",
    actions: [
      "Работать с перечнем КДЛ, а не со всеми ТВСП.",
      "Проверить четыре лаборатории без зарегистрированных протоколов.",
      "Устранить несоответствия OID КДЛ и интеграции ЛИС–МИС–РЭМД.",
    ],
    owner: "заведующий КДЛ, служба цифровизации",
    cadence: "еженедельно",
  },
  tvspDiagnostic: {
    goal: "Обеспечить передачу протоколов из каждого диагностического подразделения.",
    actions: [
      "Проверить все подразделения и оборудование в федеральном перечне.",
      "Найти ТВСП без передачи и провести тестовое исследование.",
      "Исправить привязку оборудования, подразделения и OID.",
    ],
    owner: "заместитель по диагностике, служба цифровизации",
    cadence: "еженедельно",
  },
  smpFederal: {
    goal: "Обеспечить передачу карт вызова каждой станцией и подстанцией СМП.",
    actions: [
      "Сверить плановый перечень станций и подстанций.",
      "Контролировать закрытие и подписание электронной карты.",
      "Повторно отправлять карты, отклонённые РЭМД.",
    ],
    owner: "руководитель СМП, служба цифровизации",
    cadence: "ежедневно",
  },
  tmkRemd: {
    goal: "Передавать в РЭМД протокол каждой проведённой ТМК.",
    actions: [
      "Проверить формирование и подписание протокола после консультации.",
      "Сопоставлять количество ТМК и зарегистрированных протоколов.",
      "Разобрать единственную МО без передачи.",
    ],
    owner: "заместитель по цифровизации, координатор ТМК",
    cadence: "еженедельно",
  },
  fap: {
    goal: "Обеспечить передачу СЭМД каждым подключённым к интернету ФАП и ФП.",
    actions: [
      "Проверить рабочее место, интернет и электронную подпись.",
      "Сверить OID подразделения с реестром.",
      "Провести тестовую передачу для нулевых ФАП/ФП.",
    ],
    owner: "руководитель первичного звена, служба цифровизации",
    cadence: "еженедельно",
    caution:
      "Значение предварительное до получения корректной накопительной выгрузки.",
  },
  smp: {
    goal: "Зарегистрировать карту по каждому завершённому вызову СМП.",
    actions: [
      "Ежедневно сопоставлять закрытые вызовы и зарегистрированные карты.",
      "Разбирать вызовы без СЭМД по бригаде и причине.",
      "Контролировать повторную отправку после исправления.",
    ],
    owner: "руководитель СМП, служба цифровизации",
    cadence: "ежедневно",
  },
  errors: {
    goal: "Снижать абсолютное количество отказов регистрации СЭМД.",
    actions: [
      "Ежедневно выделять три крупнейшие категории ошибок.",
      "Назначать ответственного и срок устранения по каждой категории.",
      "После исправления повторно отправлять документы и контролировать результат.",
    ],
    owner: "служба цифровизации, медицинская информационная служба",
    cadence: "ежедневно",
  },
  tmkMax: {
    goal: "Увеличивать фактически проведённые ТМК посредством МАХ.",
    actions: [
      "Обеспечить доступные слоты и информирование пациентов.",
      "Контролировать путь от записи до проведённой консультации.",
      "Разбирать МО с нулевым результатом.",
    ],
    owner: "заместитель по цифровизации",
    cadence: "ежедневно",
  },
  elnMax: {
    goal: "Закрывать ЛВН после ТМК посредством МАХ, когда это медицински необходимо.",
    actions: [
      "Проверить права и техническую готовность врачей.",
      "Сопоставлять ТМК и последующее закрытие ЛВН.",
      "Разбирать незавершённые случаи.",
    ],
    owner: "заместитель по медицинской части и цифровизации",
    cadence: "ежедневно",
  },
  visitMax: {
    goal: "Увеличивать записи к врачу на телеконсультацию посредством МАХ.",
    actions: [
      "Поддерживать актуальное расписание и свободные слоты.",
      "Контролировать ошибки записи и отмены.",
      "Информировать пациентов о доступном канале записи.",
    ],
    owner: "регистратура, заместитель по цифровизации",
    cadence: "ежедневно",
  },
  tmkMaxCount: {
    goal: "Увеличивать число фактически проведённых ТМК посредством МАХ.",
    actions: [
      "Обеспечить доступные слоты и информирование пациентов.",
      "Контролировать переход: созданный слот → запись → проведённая ТМК.",
      "Разбирать МО с нулевым результатом и незавершённые записи.",
    ],
    owner: "заместитель по цифровизации, руководители подразделений",
    cadence: "ежедневно",
    caution:
      "Сравнивать только периоды одинаковой продолжительности; дополнительно использовать среднее за день.",
  },
  elnMaxCount: {
    goal: "Использовать МАХ для закрытия ЛВН после проведённой ТМК.",
    actions: [
      "Проверить техническую возможность закрытия ЛВН у врачей.",
      "Сопоставлять проведённые ТМК и закрытые после них ЛВН.",
      "Разбирать случаи, когда ЛВН требовал закрытия, но действие не выполнено.",
    ],
    owner: "заместитель по цифровизации, медицинская служба",
    cadence: "ежедневно",
    caution:
      "Показатель отражает количество ЛВН, а не долю от всех проведённых ТМК.",
  },
  shortInput: {
    goal: "Снижать количество новых случаев краткого ввода до нуля.",
    actions: [
      "Контролировать недельный прирост отдельно по амбулаторному и стационарному блокам.",
      "Определить врачей и подразделения с наибольшим накоплением.",
      "Обеспечить полноценное ведение случая в МИС и устранить технические причины краткого ввода.",
    ],
    owner: "заместитель по медицинской части, служба цифровизации",
    cadence: "еженедельно",
  },
  shortInputAmb: {
    goal: "Сокращать краткий ввод в амбулаторном блоке и профилактике.",
    actions: [
      "Разбирать прирост по врачам и подразделениям.",
      "Проверять полноценное закрытие амбулаторного случая и профилактического обращения.",
      "Устранять шаблоны работы, создающие краткий ввод.",
    ],
    owner: "заместитель по поликлинике, служба цифровизации",
    cadence: "еженедельно",
  },
  shortInputHosp: {
    goal: "Сокращать краткий ввод в круглосуточном и дневном стационаре.",
    actions: [
      "Разбирать каждый новый случай краткого ввода.",
      "Проверять полноту ведения стационарного случая.",
      "Контролировать подразделения с повторяющимися нарушениями.",
    ],
    owner: "заместитель по медицинской части, служба цифровизации",
    cadence: "еженедельно",
  },
  hospitalCount: {
    goal: "Обеспечить полноту передачи выписных СЭМД по госпитализациям.",
    actions: [
      "Контролировать абсолютный разрыв между случаями и СЭМД.",
      "Разбирать подразделения с максимальным недостающим объёмом.",
      "Проверять закрытие случая, подписание и регистрацию документа.",
    ],
    owner: "заместитель по медицинской части",
    cadence: "ежедневно",
  },
  fapSemdCount: {
    goal: "Обеспечить передачу хотя бы одного требуемого СЭМД каждым ФАП и ФП.",
    actions: [
      "Проверить интернет, рабочее место и электронную подпись.",
      "Сверить OID ФАП/ФП с федеральным реестром.",
      "Провести тестовую передачу для каждого нулевого подразделения.",
    ],
    owner: "руководитель первичного звена, служба цифровизации",
    cadence: "еженедельно",
    caution:
      "Республиканское значение предварительное: расчётный файл содержит повреждённые ссылки.",
  },
};
Object.entries(physicianMetrics.datasets).forEach(([id, dataset]) => {
  guidance[id] = {
    goal: id.startsWith("doctor500_")
      ? "Обеспечить формирование свыше 500 зарегистрированных СЭМД каждым врачом применимой специальности за полный месяц."
      : "Обеспечить регистрацию хотя бы одного подписанного СЭМД по каждому работающему врачу за месяц.",
    actions: [
      "Сверить список врачей ФРМР с фактически работающими сотрудниками.",
      "Разобрать врачей без зарегистрированных СЭМД и с объёмом до 500 документов.",
      "Проверить электронную подпись, должность в ФРМР и регистрацию документов в РЭМД.",
    ],
    owner: "заместитель главного врача по цифровизации, отдел кадров, руководители подразделений",
    cadence: "ежемесячно",
    caution: dataset.specialty
      ? "При наличии только 1–2 врачей специальности результат показывается справочно и не влияет на приоритет заслушивания."
      : undefined,
  };
});
const fullMonthCumulativeComparison = buildFullMonthComparison(
  reportingPeriods,
  "cumulative",
);
const comparisonPeriods: Record<string, { previous: string; current: string }> =
  {
    // Оперативные ЕПГУ: сопоставимые накопительные точки 31.08 и 07.09.
    // Июль ↔ август остаётся в месячном представлении, а не выдаётся за неделю.
    egpu: { previous: "01.01–31.08.2026", current: "01.01–07.09.2026" },
    egpu2days: { previous: "01.01–31.08.2026", current: "01.01–07.09.2026" },
    birth: fullMonthCumulativeComparison,
    death: fullMonthCumulativeComparison,
    semd228: fullMonthCumulativeComparison,
    hospital: fullMonthCumulativeComparison,
    ambulatoryCase: {
      previous: "01.01–21.08.2026",
      current: "01.01–29.08.2026",
    },
    tvspStationary: {
      previous: "январь–август · срез 24.08.2026",
      current: "январь–август · срез 28.08.2026",
    },
    tvspAmbulatory: {
      previous: "январь–август · срез 24.08.2026",
      current: "январь–август · срез 28.08.2026",
    },
    tvspLaboratory: {
      previous: "январь–август · срез 24.08.2026",
      current: "январь–август · срез 28.08.2026",
    },
    tvspDiagnostic: {
      previous: "01.01–24.08.2026",
      current: "01.01–27.08.2026",
    },
    smpFederal: { previous: "01.01–18.08.2026", current: "01.01–27.08.2026" },
    smp: { previous: "01.01–20.08.2026", current: "01.01–28.08.2026" },
    shortInput: { previous: "01.01–17.08.2026", current: "01.01–20.08.2026" },
    shortInputAmb: {
      previous: "01.01–17.08.2026",
      current: "01.01–20.08.2026",
    },
    shortInputHosp: {
      previous: "01.01–17.08.2026",
      current: "01.01–20.08.2026",
    },
    tmkMaxCount: { previous: "01.08–24.08.2026", current: "01.08–28.08.2026" },
    elnMaxCount: { previous: "01.08–24.08.2026", current: "01.08–28.08.2026" },
  };
// Порядок соответствует последовательности показателей в презентации
// «ВКС 03.08.26». Непрезентационные показатели добавляются в конец.
const presentationMetricOrder = [
  "egpu",
  "egpu2days",
  "birth",
  "death",
  "semd228",
  "hospital",
  "ambulatoryCase",
  "doctorsAll",
  "doctorsLevel3",
  "doctor500_pediatrician",
  "doctor500_therapist",
  "doctor500_gp",
  "doctor500_cardiologist",
  "doctor500_oncologist",
  "doctor500_obgyn",
  "doctor500_surgeon",
  "doctor500_ophthalmologist",
  "doctor500_dentist",
  "fapSemdCount",
  "tvspDiagnostic",
  "tvspAmbulatory",
  "tvspLaboratory",
  "smpFederal",
  "tvspStationary",
  "tmkMaxCount",
  "smp",
  "errors",
];
const metricIds = [
  ...presentationMetricOrder.filter((id) => id in moData),
  ...Object.keys(moData).filter(
    (id) => id !== "elnMaxCount" && !presentationMetricOrder.includes(id),
  ),
];
const calcErrors = [
  {
    severity: "critical",
    status: "Исправлена",
    source: "ТВСП — детализация по подразделениям",
    issue: "Передающие OID считались без пересечения с плановым перечнем",
    impact:
      "У 80 строк МО результаты превышали 100%: например, 11 из 6 и 14 из 6.",
    fix: "Числитель рассчитывается только как пересечение плановых и передающих OID. После пересчёта ни одна доля ТВСП не превышает 100%.",
  },
  {
    severity: "critical",
    status: "Исправлена",
    source: "Матрица применимости МО",
    issue: "35 применимых показателей у 18 МО отображались справочно",
    impact:
      "Не учитывались ЕПГУ, СЭМД №228, госпитализации и ТВСП; приоритет заслушивания был занижен.",
    fix: "Применимость подтверждается наличием знаменателя или планового объекта в профильном источнике; матрица пересчитана по OID.",
  },
  {
    severity: "critical",
    source: "ЕПГУ — исходные расчётные столбцы",
    issue: "Выгрузка формирует отрицательные остатки −436 и −5 613",
    impact:
      "Прямое использование столбцов «Не обработано» и «Более 2 рабочих дней» меняет знак задолженности и искажает рейтинг МО.",
    fix: "Не использовать производные столбцы источника. Незавершённые = 29 635 − 29 199 = 436; завершённые позднее срока = 29 199 − 24 022 = 5 177.",
  },
  {
    severity: "critical",
    source: "ЕПГУ — сопоставимость срезов",
    issue: "Накопительный объём снизился с 32 799 до 29 635",
    impact:
      "Динамика между срезами не отражает реальное изменение работы МО и может дать ложное улучшение или ухудшение.",
    fix: "Текущий срез отображается отдельно; динамика и сравнение отключены до объяснения изменения состава выгрузки.",
  },
  {
    severity: "high",
    status: "Исправлена",
    source: "МАХ — ТМК и ЛВН",
    issue: "Слоты смешивались с фактом оказанной услуги",
    impact:
      "Проведённых ТМК может быть больше занятых слотов, поэтому доли от слотов методически нестабильны.",
    fix: "Используются только абсолютные значения: 6 601 проведённая ТМК и 6 240 закрытых ЛВН. Слоты исключены.",
  },
  {
    severity: "critical",
    status: "Исправлена",
    source: "Госпитализации — выбор знаменателя",
    issue: "Лист 2 даёт региональный результат 103,29%",
    impact:
      "Знаменатель 438 849 не соответствует полному количеству случаев стационарной помощи.",
    fix: "Использован лист 3: 453 267 СЭМД из 615 090 случаев — 73,69%.",
  },
  {
    severity: "high",
    source: "Госпитализации — контроль уникальности",
    issue: "У шести МО документов больше, чем случаев",
    impact:
      "Показатель превышает 100% у ДГБ №8, ГКБ №12, ГКБ №7, ГКБ №16, Центра реабилитации слуха и ДГП №4.",
    fix: "Фактическое значение показывается без сокрытия; балл рейтинга ограничивается 100. Требуется проверить повторные и исправленные версии СЭМД.",
  },
  {
    severity: "high",
    source: "ТВСП — разные уровни детализации",
    issue:
      "Федеральный итог по зданиям нельзя смешивать с контролем всех подразделений",
    impact:
      "Региональный итог может быть близок к 100%, хотя внутри зданий остаются сотни непередающих СП.",
    fix: "Разделены федеральный итог по объектам и управленческая детализация по обязательным подразделениям.",
  },
  {
    severity: "high",
    source: "ТВСП — ГП №18",
    issue:
      "Два эндоскопических кабинета включены в перечень непередающих амбулаторные СЭМД",
    impact:
      "До подтверждения применимости ГП №18 может быть необоснованно отнесена к отстающим.",
    fix: "Строка помечена как требующая уточнения; эти кабинеты не использовать для санкций до ответа владельца федеральной методики/ФРМО.",
  },
  {
    severity: "critical",
    status: "Расчёт приостановлен",
    source: "СЭМД профилактического осмотра (диспансеризации)",
    issue:
      "При расчёте показателя за 2026 год необходимо использовать наибольшее количество зарегистрированных СЭМД 122 или СЭМД 228 по каждой МО",
    impact:
      "Использование только СЭМД 228 искусственно занижает показатель медицинских организаций, в том числе детских МО, формирующих СЭМД 122.",
    fix: "Базовая логика изменена: 2026 — MAX(СЭМД 122; СЭМД 228) отдельно по каждой МО; с 01.01.2027 — только СЭМД 228. До получения СЭМД 122 показатель исключён из рейтинга и заслушивания.",
    temporary:
      "Прежний расчёт 43,25% и значения МО показываются только как контрольные «до исправления», без оценки выполнения.",
    needed:
      "Выгрузка СЭМД 122 по МО за 01.01–27.08.2026 либо новый единый сопоставимый комплект СЭМД 122, СЭМД 228 и обращений ФОМС.",
  },
  {
    severity: "high",
    source: "ЭЛМК — применимость",
    issue: "Нулевая передача не доказывает обязанность МО формировать ЭЛМК",
    impact:
      "МО без соответствующей лицензии или функции могут ошибочно попасть в отстающие.",
    fix: "Сохранён плановый перечень 74 МО; ноль не считается нарушением до подтверждения применимости. OID номерных МО подлежат контрольной сверке.",
  },
  {
    severity: "medium",
    source: "Комплект исходников",
    issue: "Четыре показателя не получили новую выгрузку",
    impact: "На дашборде одновременно присутствуют разные даты актуальности.",
    fix: "Случаи краткого ввода, амбулаторные случаи, Инцидент 38 и электронный путевой лист оставлены на прежних срезах с явной датой.",
  },
  {
    severity: "high",
    status: "Исправлена",
    source: "Свидетельства о смерти — применимость МО",
    issue: "Отсутствие применимых случаев интерпретировалось как невыполнение",
    impact:
      "АДРБ с ПЦ получала 0 баллов при отсутствии случаев оформления медицинских свидетельств о смерти.",
    fix: "Показатель исключён из персонального знаменателя АДРБ с ПЦ; отсутствие случаев не считается нулевым результатом.",
  },
  {
    severity: "high",
    status: "Исправлена",
    source: "ТМК и ЛВН посредством МАХ",
    issue:
      "Противотуберкулёзные организации попадали в список с нулевым результатом",
    impact:
      "РКПД и Зеленодольский ПТД ошибочно показывались как не использующие сервис при особом порядке закрытия ЛВН.",
    fix: "Противотуберкулёзные МО исключены из управленческих списков ТМК и закрытия ЛВН через МАХ.",
  },
  {
    severity: "high",
    source: "КДЛ — плановый перечень",
    issue: "Кайбицкая ЦРБ отсутствует в исходном перечне КДЛ",
    impact: "Организация была полностью скрыта из детализации показателя.",
    fix: "МО добавлена в управленческую таблицу со статусом «Нет данных»; для расчёта факта требуется строка КДЛ из источника.",
  },
  {
    severity: "critical",
    status: "Исправлена",
    source: "ЭЛМК — плановый перечень 74 МО",
    issue: "Повторяющиеся чужие OID у семи строк",
    impact:
      "Факт нескольких номерных поликлиник относился к ГП №8; в заслушиваниях появлялось ложное «Нет данных».",
    fix: "OID восстановлены по мастер-справочнику; добавлена блокировка повторных OID.",
  },
  {
    severity: "high",
    status: "Исправлена",
    source: "ТВСП и заслушивания МО",
    issue: "Агрегат МО и детализация подразделений были из разных срезов",
    impact:
      "Например, ДГБ №8 показывалась как 100% вместо 1 из 2 подразделений — 50%.",
    fix: "Управленческие строки и заслушивания пересчитаны из детализации на 24.08.2026.",
  },
  {
    severity: "critical",
    source: "Госпитализации — свод",
    issue: "106 внешних ссылок вида [1]Лист1",
    impact: "Расчёт зависит от другой книги и может не обновиться.",
    fix: "Заменить внешние ссылки на загрузку текущего исходника по OID.",
  },
  {
    severity: "critical",
    source: "ФАП/ФП — лист «Для ВКС»",
    issue: "Повреждённые формулы #REF!",
    impact: "Часть строк не имеет корректной связи с исходными данными.",
    fix: "Перестроить ключ подразделения: OID МО + OID ФАП/ФП.",
  },
  {
    severity: "critical",
    source: "ФАП/ФП",
    issue: "Ручные формулы 51×100÷53 и 37×100÷39",
    impact: "Числитель и знаменатель не связаны с ячейками и не обновляются.",
    fix: "Считать количество передающих и плановых подразделений автоматически.",
  },
  {
    severity: "high",
    source: "Свидетельства о рождении",
    issue: "Доли рассчитаны вручную: 176×100÷177, 918×100÷940",
    impact: "При замене исходника итог может остаться старым.",
    fix: "Агрегировать записи по МО и признаку наличия СЭМД.",
  },
  {
    severity: "high",
    source: "Свидетельства о смерти",
    issue: "17 ручных формул с фиксированными числами",
    impact: "Невозможно гарантировать автоматическое обновление долей.",
    fix: "Рассчитывать долю непосредственно из реестра свидетельств.",
  },
  {
    severity: "high",
    source: "Периоды расчёта",
    issue: "Смешаны месячные и накопительные значения",
    impact: "Динамика июня–июля несопоставима с недельной динамикой августа.",
    fix: "Хранить тип периода: неделя, месяц, накопительно с начала года.",
  },
  {
    severity: "medium",
    source: "ЕПГУ — подпись периода",
    issue: "В одном расчёте указано 29.01 вместо 29.07",
    impact: "Руководитель видит неверный период сравнения.",
    fix: "Формировать подписи периода из метаданных исходного файла.",
  },
  {
    severity: "medium",
    source: "Свидетельства о рождении",
    issue: "Показатель подписан до 05.08, исходник — до 03.08",
    impact: "Завышается заявленная актуальность данных.",
    fix: "Показывать фактическую дату окончания выгрузки.",
  },
  {
    severity: "medium",
    source: "Листы «Для ВКС»",
    issue: "Часть рейтингов заполнена статическими значениями",
    impact: "Топ лучших и отстающих не пересчитывается автоматически.",
    fix: "Строить рейтинг сортировкой единой таблицы показателей.",
  },
  {
    severity: "medium",
    source: "Сопоставление МО",
    issue: "VLOOKUP и SUMIF используют наименование МО",
    impact: "Пробел или сокращение исключает организацию из расчёта.",
    fix: "Использовать OID как основной ключ, название — только для отображения.",
  },
  {
    severity: "medium",
    source: "Столбец «Динамика»",
    issue: "Проценты смешаны с процентными пунктами",
    impact: "Изменение доли может интерпретироваться как темп роста.",
    fix: "Разделить: изменение доли, темп роста и абсолютный прирост.",
  },
  {
    severity: "high",
    status: "Исправлена частично",
    source: "ЭПЛ — отчёт 24.08–30.08.2026",
    issue: "Дочерние строки без номера ранее исключались из детализации",
    impact:
      "Прежний загрузчик не учитывал 46 строк подразделений. В новом отчёте это 265 ТС, 89 ТС с движением, 634 путевых листа и 362 активных водителя.",
    fix: "Региональные карточки считаются по итоговой строке источника. В новой детализации строки без номера объединены с предшествующей нумерованной группой.",
    temporary:
      "Динамика отдельных МО отключена до второго среза, обработанного по той же схеме.",
    needed:
      "Подтвердить у владельца отчёта, что пустой номер означает дочернее подразделение предыдущей организации.",
  },
  {
    severity: "high",
    source: "Случаи краткого ввода — 01.01–28.08.2026",
    issue:
      "Накопительные значения уменьшились у пяти строк, одна организация исчезла из выгрузки",
    impact:
      "Снижение накопительного показателя может быть исправлением источника, а не улучшением работы МО.",
    fix: "Такие строки отмечены предупреждением; показатель остаётся справочным и не влияет на рейтинг или заслушивание.",
    temporary:
      "Текущий факт показывается без автоматической интерпретации снижения как улучшения.",
    needed:
      "Получить объяснение корректировок и строку для исчезнувшей организации.",
  },
  {
    severity: "high",
    source: "Случаи краткого ввода — идентификация МО",
    issue:
      "Один OID присвоен двум строкам «Прозрение», одна строка не имеет OID",
    impact:
      "Объединение только по OID смешивает разные организации; строку без OID нельзя надёжно связать с другими источниками.",
    fix: "Строки сохраняются раздельно по сочетанию названия и OID.",
    temporary:
      "Строка без OID учитывается в региональном итоге, но не связывается с карточкой МО.",
    needed: "Уточнить корректные OID у владельца ГИС ЭЗ РТ.",
  },
  {
    severity: "medium",
    source: "Врачи, сформировавшие более 500 СЭМД",
    issue: "Выгрузка сформирована 31.08 до закрытия календарного месяца",
    impact:
      "Предварительный август нельзя сопоставлять с завершённым месяцем и использовать в оценке МО.",
    fix: "Файл проанализирован, но данные не загружены в показатель.",
    temporary: "Сохраняется последний подтверждённый полный месяц.",
    needed:
      "Загрузить закрытую месячную выгрузку в начале сентября; подтвердить расчёт по назначениям врач–МО и строгий порог 501+.",
  },
];

type Methodology = {
  id: string;
  name: string;
  formula: string;
  numerator: string;
  denominator: string;
  source: string;
  cadence: string;
  note?: string;
  legal?: string;
};

type VitacoreInstruction = {
  form: string;
  path: string;
  action: string;
  result: string;
  control: string;
  source?: string;
};

const vitacoreInstructions: Record<string, VitacoreInstruction> = {
  birth: {
    form: "Медицинское свидетельство о рождении; учетная форма № 103/у.",
    path: "СЭМД-документы → Медицинское свидетельство о рождении.",
    action: "Заполнить сведения о матери и ребёнке, документе и подписывающем сотруднике; сформировать и подписать документ.",
    result: "СЭМД 76 либо сведения бумажного свидетельства — СЭМД 118, в зависимости от способа оформления.",
    control: "Проверить подпись МО и успешную регистрацию документа в РЭМД.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=498566584",
  },
  death: {
    form: "Медицинское свидетельство о смерти; учетная форма № 106/у.",
    path: "СЭМД-документы → Медицинское свидетельство о смерти.",
    action: "Создать свидетельство, заполнить сведения о пациенте, обстоятельствах и причинах смерти, выбрать подписывающего сотрудника.",
    result: "Электронное свидетельство либо СЭМД 113 со сведениями бумажного свидетельства.",
    control: "Проверить подписание и статус регистрации в РЭМД.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=451281003",
  },
  semd228: {
    form: "Медицинский осмотр: ДОГВН или профилактический медицинский осмотр.",
    path: "Случай пациента → Медицинский осмотр → Анкета, обследование и результат → Основные результаты диспансеризации.",
    action: "Заполнить услуги, результаты и группу состояния здоровья; открыть «Мед. документация» и сформировать применимый документ.",
    result: "В 2026 году для показателя учитывается большее количество СЭМД 122 или СЭМД 228 по каждой МО.",
    control: "Документ должен быть сформирован, подписан и успешно зарегистрирован в РЭМД; 122 и 228 не суммируются.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=475890497",
  },
  hospital: {
    form: "Выписной эпикриз стационарного случая или выписной эпикриз из родильного дома.",
    path: "АРМ врача отделения → Лежащие в отделении → Подготовить эпикриз → Выписной эпикриз.",
    action: "Завершить выписной эпикриз, затем выбрать требуемый документ через «Медицинская документация».",
    result: "СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома».",
    control: "Проверить подписи врача и МО и успешную регистрацию в РЭМД.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=466060800",
  },
  ambulatoryCase: {
    form: "Исход законченного амбулаторного случая обращения.",
    path: "Случай обращения или дневник врача → Закрыть случай → Исход обращения.",
    action: "Заполнить исход и обязательные сведения, сохранить закрытие случая и сформировать медицинский документ.",
    result: "СЭМД 233 «Эпикриз по законченному случаю амбулаторный».",
    control: "Проверить, что случай закрыт, документ подписан и зарегистрирован в РЭМД.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=498565210",
  },
  tvspLaboratory: {
    form: "Результат выполненного лабораторного исследования.",
    path: "Диагностика → Проведённые исследования → исследование пациента.",
    action: "Заполнить результаты, рекомендации, заключение и сведения о материале; выбрать «Мед. документация».",
    result: "СЭМД 186 «Протокол лабораторного исследования».",
    control: "Подписать документ и проверить регистрацию в РЭМД от правильного OID КДЛ.",
    source: "https://wiki.vitacore.ru/plugins/viewsource/viewpagesrc.action?pageId=491749393",
  },
  tvspDiagnostic: {
    form: "Результат выполненного инструментального диагностического исследования.",
    path: "Диагностика → Проведённые исследования → Медицинская документация.",
    action: "Заполнить протокол, описание и заключение исследования; сформировать и подписать документ.",
    result: "СЭМД «Протокол инструментального диагностического исследования».",
    control: "Проверить регистрацию в РЭМД и соответствие OID диагностического ТВСП.",
  },
  tvspAmbulatory: {
    form: "Законченный амбулаторный случай, талон амбулаторного пациента либо консультация врача.",
    path: "Случай обращения / дневник врача → закрытие случая или медицинская документация консультации.",
    action: "Корректно завершить случай или консультацию, заполнить исход и обязательные разделы документа.",
    result: "СЭМД 233, «Талон амбулаторного пациента» либо СЭМД 119 «Протокол консультации».",
    control: "Проверить подпись, регистрацию в РЭМД и OID амбулаторного ТВСП.",
  },
  oncologyCouncil: {
    form: "Протокол онкологического консилиума.",
    path: "Онкологическая маршрутная карта / решение консилиума → Медицинская документация.",
    action: "Оформить состав консилиума, решение и рекомендации; сформировать и подписать протокол.",
    result: "СЭМД 190 «Протокол консилиума врачей (онкологического)».",
    control: "Проверить регистрацию в РЭМД от МО и подразделения планового перечня.",
  },
  tmkRemd: {
    form: "Протокол завершённой телемедицинской консультации.",
    path: "Случай ТМК → протокол консультации → Медицинская документация.",
    action: "Заполнить результат и рекомендации ТМК, сформировать и подписать протокол.",
    result: "СЭМД 40 «Протокол телемедицинской консультации».",
    control: "Проверить успешную регистрацию протокола в РЭМД.",
  },
  elmk: {
    form: "Медицинский осмотр работника и итоговое медицинское заключение.",
    path: "Профессиональные медицинские осмотры → заключение по результатам осмотра → Медицинская документация.",
    action: "Заполнить вид и профиль работы, результаты осмотра, заключение и дату следующего осмотра.",
    result: "СЭМД 230 для предоставления в подсистему ЭЛМК.",
    control: "Проверить подписание и регистрацию СЭМД 230 в РЭМД.",
    source: "https://wiki.vitacore.ru/pages/viewpage.action?pageId=458588660",
  },
};
const methodologies: Methodology[] = [
  {
    id: "organizationRating",
    name: "Интегральный рейтинг медицинских организаций",
    formula:
      "70% × балл полноты сопровождения случаев + 20% × балл цифровых услуг + 10% × балл технической готовности",
    numerator:
      "Средние нормированные баллы применимых показателей внутри трёх блоков. Балл отдельного показателя: факт / план × 100; для обратных показателей: план / факт × 100; максимум 100 баллов.",
    denominator:
      "В расчёт включаются только применимые к МО показатели. Если блок неприменим, его вес исключается, остальные веса нормируются.",
    source: "Расчёт дашборда на основании представленных исходников",
    cadence: "Еженедельно, нарастающим итогом",
    note: "МО сравниваются только внутри своего типа. Показатель КДЛ и неполная выгрузка ошибок регистрации в интегральный рейтинг не включаются. Абсолютные объёмы не влияют на место.",
  },
  {
    id: "incident38",
    name: "Инцидент 38 — запись на приём к врачу",
    formula:
      "Доля дистанционных записей = (записи через дистанционные каналы / общее количество записей в рамках ОМС) × 100%",
    numerator:
      "Записи через ЕПГУ, региональный портал, колл-центр, инфомат, АРМ медицинского специалиста, МАХ и иные дистанционные каналы в соответствии с методикой.",
    denominator:
      "Общее количество записей на приём в рамках ОМС за сопоставимый отчётный период.",
    source: "ФЭР ЕГИСЗ / ФОМС / региональные сервисы записи",
    cadence: "Ежемесячно, нарастающим итогом",
    note: "В текущих исходниках подтверждено только количество записей через МАХ — 964. Для расчёта доли и рейтинга по МО требуются полный числитель, знаменатель и выгрузка в разрезе медицинских организаций.",
  },
  {
    id: "egpu",
    name: "Доля заявлений о прикреплении на ЕПГУ с финальным статусом",
    formula: "(Заявления с финальным статусом / поступившие заявления) × 100%",
    numerator:
      "Заявления, по которым гражданину направлен финальный статус оказания услуги.",
    denominator:
      "Все заявления о прикреплении, поступившие медицинским организациям через ЕПГУ.",
    source: "Интеграционная подсистема ЕГИСЗ / ЕПГУ",
    cadence: "Ежемесячно, нарастающим итогом",
    note: "Финальный статус включает успешное прикрепление и мотивированный отказ. Незавершённое заявление в числитель не включается.",
  },
  {
    id: "egpu2days",
    name: "Доля заявлений о прикреплении, рассмотренных в течение 2 дней",
    formula:
      "(Заявления, рассмотренные в регламентный срок / все поданные заявления) × 100%",
    numerator:
      "Заявления, рассмотренные медицинской организацией в регламентный срок.",
    denominator:
      "Все заявления о прикреплении, поданные через ЕПГУ за отчётный период.",
    source: "Интеграционная подсистема ЕГИСЗ / ЕПГУ",
    cadence: "Ежемесячно, нарастающим итогом",
    note: "Регламентный срок — 2 рабочих дня с даты получения заявления медицинской организацией, а не 2 календарных дня. Основание: приказ Минздрава России от 14.04.2025 № 216н.",
  },
  {
    id: "birth",
    name: "МСР",
    formula:
      "(Электронные свидетельства, зарегистрированные в ФРМСР / акты о рождении) × 100%",
    numerator:
      "Медицинские свидетельства о рождении в форме ЭМД, зарегистрированные в ЕГИСЗ.",
    denominator: "Общее количество актов гражданского состояния о рождении.",
    source: "Выгрузка ГИС ЭЗ РТ; статус «Зарегистрирован» принимается как регистрация в ФРМСР ЕГИСЗ",
    cadence: "Еженедельно; накопительно с начала года",
    note: "Числитель и знаменатель берутся за один период. Учитывается регистрация документа в федеральном реестре, а не только его формирование в МИС.",
  },
  {
    id: "death",
    name: "МСС",
    formula:
      "(Электронные свидетельства, зарегистрированные в ФРМСС / акты о смерти) × 100%",
    numerator:
      "Медицинские свидетельства о смерти в форме ЭМД, зарегистрированные в ЕГИСЗ.",
    denominator: "Общее количество актов гражданского состояния о смерти.",
    source: "Выгрузка ГИС ЭЗ РТ; статус «Зарегистрирован» принимается как регистрация в ФРМСС ЕГИСЗ",
    cadence: "Еженедельно; накопительно с начала года",
    note: "Числитель и знаменатель берутся за один период. Если у МО не было случаев, по которым она должна оформить медицинское свидетельство о смерти, показатель помечается «Нет применимых случаев» и исключается из её рейтинга. Документ с ошибкой регистрации не входит в числитель до успешной повторной отправки.",
  },
  {
    id: "semd228",
    name: "Доля СЭМД (122/228) профилактического осмотра (диспансеризации)",
    formula:
      "2026: MAX(СЭМД 122; СЭМД 228) по каждой МО ÷ обращения ФОМС × 100%. С 01.01.2027: СЭМД 228 ÷ обращения ФОМС × 100%.",
    numerator:
      "За 2026 год — наибольшее из количества успешно зарегистрированных СЭМД 122 и СЭМД 228 отдельно для каждой МО и отчётного периода. С 01.01.2027 — только СЭМД 228.",
    denominator:
      "Количество обращений с профилактической целью / диспансеризацией по данным ФОМС за тот же период и по той же МО.",
    source:
      "Федеральный отчёт РЭМД по МО (СЭМД 122 и 228) + выгрузка ФОМС по обращениям с профилактической целью",
    cadence: "Еженедельно; накопительно с начала года",
    note: "На 31.08.2026: 1 514 789 / 2 012 724 = 75,26%. СЭМД 122 и 228 не суммируются: MAX выбирается по каждой МО, затем значения агрегируются по РТ. Включены взрослые и детские МО. Одна несопоставленная частная строка из Ижевска (знаменатель 1) исключена и сохранена в аудите.",
    legal:
      "Федеральная методика показателя: переходное правило до 31.12.2026 — MAX по СЭМД 122/228; с 01.01.2027 — только СЭМД 228.",
  },
  {
    id: "hospital",
    name: "Доля СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома» относительно количества случаев",
    formula:
      "(Зарегистрированные выписные СЭМД / завершённые случаи стационарной помощи) × 100%",
    numerator:
      "СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома».",
    denominator: "Случаи медицинской помощи, оказанной в условиях стационара.",
    source: "ГИС ЭЗ РТ / РЭМД ЕГИСЗ",
    cadence: "Еженедельно; накопительно с начала года",
    note: "Сопоставляются завершённые случаи и зарегистрированные документы за одинаковый период. Повторные версии одного документа не должны завышать числитель.",
  },
  {
    id: "ambulatoryCase",
    name: "Доля СЭМД «Эпикриз по законченному случаю амбулаторный» (СЭМД №92, №233) относительно количества случаев",
    formula:
      "(Зарегистрированные амбулаторные СЭМД / случаи ПМСП, поданные на оплату) × 100%",
    numerator:
      "СЭМД «Эпикриз по законченному случаю амбулаторный» (СЭМД №92, №233).",
    denominator:
      "Случаи оказания первичной медико-санитарной помощи, поданные на оплату; используются как доступный рабочий знаменатель при отсутствии отдельной выгрузки завершённых случаев.",
    source: "ГИС ЭЗ РТ / РЭМД ЕГИСЗ",
    cadence: "Еженедельно; накопительно с начала года",
    note: "Краткий ввод и незакрытый амбулаторный случай могут не сформировать требуемый СЭМД. Представленный отчёт использует случаи, поданные на оплату: это согласованный рабочий знаменатель до появления отдельной выгрузки завершённых случаев ПМСП.",
  },
  {
    id: "elmk",
    name: "Доля МО, обеспечивших передачу СЭМД «Медицинское заключение по результатам медицинского осмотра для предоставления в подсистему ЭЛМК» в РЭМД ЕГИСЗ",
    formula:
      "(МО с зарегистрированным СЭМД для ЭЛМК / МО утверждённого планового перечня) × 100%",
    numerator:
      "Медицинские организации из планового перечня, от которых зарегистрирован требуемый СЭМД.",
    denominator: "Утверждённый плановый перечень 74 медицинских организаций.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
    note: "На 28.08.2026 передача подтверждена у 67 из 74 МО — 90,54%. Нулевой результат требует проверки лицензии и не считается нарушением автоматически.",
  },
  {
    id: "oncologyCouncil",
    name: "Доля МО II и III уровня с подразделениями онкологического профиля, формирующих СЭМД «Протокол консилиума врачей онкологического»",
    formula:
      "(МО с зарегистрированным протоколом / плановые МО II и III уровней) × 100%",
    numerator:
      "МО, от которых зарегистрирован СЭМД «Протокол консилиума врачей онкологического».",
    denominator:
      "МО II и III уровней с подразделениями онкологического профиля по ФРМО.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Ежемесячно",
  },
  {
    id: "fapSemdCount",
    name: "ФАП и ФП, обеспечивающие доступ граждан к ЭМД",
    formula:
      "(ФАП и ФП с передачей СЭМД / плановый перечень подключённых ФАП и ФП) × 100%",
    numerator: "ФАП и ФП, от которых зарегистрирован требуемый СЭМД.",
    denominator:
      "ФАП и ФП, подключённые к Интернету и включённые в плановый перечень.",
    source: "ГИС ЭЗ РТ / ФРМО / РЭМД",
    cadence: "Еженедельно",
    note: "В рабочей таблице дополнительно показывается абсолютное количество зарегистрированных СЭМД.",
  },
  {
    id: "tvspDiagnostic",
    name: "Доля ТВСП, передающих СЭМД «Протокол диагностических исследований»",
    formula:
      "(ТВСП с зарегистрированным протоколом / плановые диагностические ТВСП) × 100%",
    numerator:
      "ТВСП, от которых зарегистрирован СЭМД «Протокол диагностических исследований».",
    denominator: "ТВСП, обязанные передавать этот вид СЭМД по сведениям ФРМО.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
  },
  {
    id: "tvspAmbulatory",
    name: "Доля амбулаторных ТВСП, передающих СЭМД «Эпикриз по законченному случаю амбулаторный» («Талон амбулаторного пациента») и/или «Протокол консультации»",
    formula:
      "(Передающие амбулаторные ТВСП / плановое количество амбулаторных ТВСП) × 100%",
    numerator:
      "На федеральном уровне — объекты/здания с передачей; в управленческой детализации — только плановые OID СП, присутствующие также в перечне передающих.",
    denominator: "Плановые амбулаторные ТВСП по ФРМО; ФАП и ФП не учитываются.",
    source: "РЭМД ЕГИСЗ / ФРМО ЕГИСЗ",
    cadence: "Ежемесячно, нарастающим итогом",
    note: "Федеральный итог на 28.08.2026: 460 из 461 — 99,78%. Управленческий числитель по МО считается пересечением плановых и передающих OID и не может превышать знаменатель.",
  },
  {
    id: "tvspLaboratory",
    name: "Доля КДЛ, передающих СЭМД «Протокол лабораторного исследования»",
    formula:
      "(КДЛ с зарегистрированным протоколом / плановый перечень КДЛ) × 100%",
    numerator:
      "КДЛ, от которых зарегистрирован СЭМД «Протокол лабораторного исследования».",
    denominator: "КДЛ и лаборатории, обязанные передавать документ по ФРМО.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
    note: "Контрольный расчёт нового среза: 123 ÷ 127 × 100 = 96,85%. Ранее зафиксированные 97,50% не воспроизводились из числителя и знаменателя источника и не переносятся в новый срез.",
  },
  {
    id: "smpFederal",
    name: "Доля станций и подстанций СМП, передающих СЭМД «Карта вызова скорой медицинской помощи»",
    formula:
      "(Подразделения СМП с зарегистрированной картой / плановые подразделения СМП) × 100%",
    numerator:
      "Станции и подстанции, от которых зарегистрирован СЭМД «Карта вызова скорой медицинской помощи».",
    denominator: "Отделения, станции и подстанции СМП по ФРМО.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
  },
  {
    id: "tvspStationary",
    name: "Доля ТВСП, передающих СЭМД «Эпикриз в стационаре выписной» и/или «Выписной эпикриз из родильного дома»",
    formula:
      "(Стационарные ТВСП с зарегистрированным эпикризом / плановые стационарные ТВСП) × 100%",
    numerator:
      "ТВСП с зарегистрированным выписным эпикризом стационара или родильного дома.",
    denominator: "Стационарные ТВСП, обязанные передавать документ по ФРМО.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
  },
  {
    id: "tmkRemd",
    name: "Доля МО, обеспечивших передачу СЭМД «Протокол телемедицинской консультации» в РЭМД ЕГИСЗ",
    formula: "(МО с зарегистрированным протоколом ТМК / плановые МО) × 100%",
    numerator:
      "МО, от которых зарегистрирован СЭМД «Протокол телемедицинской консультации».",
    denominator:
      "Медицинские организации, обязанные передавать данный вид СЭМД.",
    source: "Федеральная BI / ФРМО / РЭМД",
    cadence: "Еженедельно",
    note: "План — 100%. Контрольный срез: 39 из 40 МО обеспечили передачу — 97,50%. В полном плановом перечне нулевой результат у Набережно-Челнинской инфекционной больницы.",
  },
  {
    id: "tmkMaxCount",
    name: "Количество ТМК посредством МАХ",
    formula:
      "Количество завершённых телемедицинских консультаций за отчётный период",
    numerator: "Фактически завершённые ТМК, проведённые с использованием МАХ.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ / МАХ",
    cadence: "Еженедельно и за полный месяц",
    note: "Оперативный факт на 07.09.2026 — 103 940 при плане 193 000 на 2026 год. Для рейтинга МО используются полные накопительные срезы на 31.07 и 31.08; оперативный итог РТ показывается отдельно.",
  },
  {
    id: "elnMaxCount",
    name: "Количество ЛВН, закрытых после ТМК посредством МАХ",
    formula:
      "Количество листков нетрудоспособности, закрытых по результатам ТМК",
    numerator: "Закрытые ЛВН, связанные с завершённой ТМК посредством МАХ.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ / МАХ",
    cadence: "Еженедельно и за полный месяц",
    note: "Оперативный факт на 07.09.2026 — 77 629 при плане 99 000 на 2026 год. Для рейтинга МО используются полные накопительные срезы на 31.07 и 31.08.",
  },
  {
    id: "visitMax",
    name: "Количество записей к врачу на телеконсультацию посредством МАХ",
    formula: "Количество записей к врачу на телеконсультацию посредством МАХ",
    numerator:
      "Записи к врачу посредством МАХ.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "Дашборд ЦЦТ РТ / МАХ",
    cadence: "Еженедельно и за полный месяц",
    note: "Оперативный факт на 07.09.2026 — 253 169 при плане 654 000 на 2026 год.",
  },
  {
    id: "smp",
    name: "Доля СЭМД «Карта вызова скорой медицинской помощи» относительно количества случаев скорой помощи",
    formula:
      "(Зарегистрированные СЭМД «Карта вызова скорой медицинской помощи» / завершённые случаи СМП) × 100%",
    numerator:
      "Карты вызова со статусом «Принято» в АСУ СМП; этот статус принимается как успешная регистрация в РЭМД ЕГИСЗ.",
    denominator: "Количество карт вызова — завершённых случаев оказания скорой медицинской помощи по данным АСУ СМП.",
    source: "АСУ СМП: «Принято» / «Количество карт»",
    cadence: "Еженедельно; накопительно с начала года",
  },
  {
    id: "errors",
    name: "Количество ошибок регистрации СЭМД за август",
    formula: "Сумма количества отказов регистрации СЭМД за полный отчётный месяц",
    numerator:
      "Запросы на регистрацию СЭМД, при обработке которых зафиксирована ошибка.",
    denominator: "Не применяется: в выгрузке нет числа всех обработанных запросов.",
    source: "Федеральная BI / РЭМД ЕГИСЗ",
    cadence: "Ежемесячно; полный календарный месяц",
    note: "Показано абсолютное количество отказов за август. Доля и оценка качества без знаменателя не рассчитываются.",
  },
  {
    id: "shortInput",
    name: "Случаи краткого ввода",
    formula:
      "Амбулаторный блок + профилактика + круглосуточный стационар + дневной стационар",
    numerator:
      "Все накопленные случаи краткого ввода по МО и видам медицинской помощи.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ",
    cadence: "Еженедельно, накопительно с начала года",
    note: "Чем ближе результат к нулю, тем лучше. Рост накопительного значения является ухудшением; для оперативного управления отдельно показывается прирост между срезами. На 20.08.2026: 649 689 амбулаторных и профилактических случаев, 9 479 стационарных, всего 659 168.",
  },
  {
    id: "shortInputAmb",
    name: "Краткий ввод — амбулаторный блок и профилактика",
    formula:
      "Амбулаторные случаи краткого ввода + профилактические обращения краткого ввода",
    numerator: "Случаи в амбулаторном блоке и профилактике по каждой МО.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ",
    cadence: "Еженедельно, накопительно с начала года",
    note: "Направление улучшения: снижение до нуля.",
  },
  {
    id: "shortInputHosp",
    name: "Краткий ввод — стационарный блок",
    formula: "Круглосуточный стационар + дневной стационар",
    numerator: "Стационарные случаи краткого ввода по каждой МО.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ",
    cadence: "Еженедельно, накопительно с начала года",
    note: "Направление улучшения: снижение до нуля.",
  },
  {
    id: "hospitalCount",
    name: "Количество госпитализаций",
    formula: "Количество случаев госпитализации за отчётный период",
    numerator: "Завершённые случаи оказания помощи в условиях стационара.",
    denominator: "Не применяется — абсолютный показатель.",
    source: "ГИС ЭЗ РТ",
    cadence: "Еженедельно и накопительно с начала года",
  },
];
Object.entries(physicianMetrics.datasets).forEach(([id, dataset]) => {
  const threshold = id.startsWith("doctor500_");
  methodologies.push({
    id,
    name: dataset.name,
    formula: threshold
      ? "(Врачи специальности, зарегистрировавшие свыше 500 СЭМД / врачи специальности по ФРМР) × 100%"
      : "(Врачи, зарегистрировавшие хотя бы один СЭМД / врачи по ФРМР) × 100%",
    numerator: threshold
      ? "Уникальные пары OID МО + OID медицинского работника соответствующей специальности, по которым за месяц зарегистрировано свыше 500 СЭМД."
      : "Уникальные пары OID МО + OID медицинского работника, по которым за месяц зарегистрирован хотя бы один СЭМД.",
    denominator: threshold
      ? "Работающие врачи соответствующей специальности по данным ФРМР."
      : id === "doctorsLevel3"
        ? "Работающие врачи медицинских организаций III уровня по данным ФРМР."
        : "Работающие врачи по данным ФРМР.",
    source: "Федеральная BI: РЭМД ЕГИСЗ / ФРМР ЕГИСЗ",
    cadence: "Ежемесячно; отдельный полный календарный месяц",
    note: threshold
      ? "При знаменателе 1–2 врача результат показывается справочно и не учитывается в приоритете заслушивания. Категории до 100, 101–500 и свыше 500 сверяются с общим числом подписавших врачей."
      : "Август 2026 показан как самостоятельный месячный результат.",
  });
});

function statusFor(fact: number, plan: number | null, reverse = false): Status {
  if (plan === null) return "na";
  const ratio = reverse ? plan / fact : fact / plan;
  if (ratio >= 1) return "good";
  if (ratio >= 0.9) return "warn";
  return "bad";
}

function format(v: number | null, digits = 2) {
  if (v === null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
  }).format(v);
}

function federalMetric(text: string) {
  const percentages = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/giu)];
  if (percentages.length) {
    const value = Number(percentages.at(-1)![1].replace(",", "."));
    const detail = text
      .replace(/(?:не\s+(?:менее|более)\s+)?\d+(?:[.,]\d+)?\s*%/giu, "")
      .replace(/^[\s·,;:\-]+|[\s·,;:\-]+$/gu, "")
      .trim();
    return {
      value,
      unit: "%" as const,
      display: `${format(value, 2)}%`,
      detail,
    };
  }
  const absolute = text.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(млн|тыс\.)?/iu);
  if (!absolute)
    return { value: null, unit: "text" as const, display: text, detail: "" };
  const raw = Number(absolute[1].replace(/\s/gu, "").replace(",", "."));
  const scale = absolute[2]?.toLowerCase().startsWith("млн")
    ? 1_000_000
    : absolute[2]?.toLowerCase().startsWith("тыс")
      ? 1_000
      : 1;
  return {
    value: raw * scale,
    unit: "count" as const,
    display: format(raw * scale, 0),
    detail: text,
  };
}

function federalCategory(
  row: FederalControlRow,
): Exclude<ExtendedCategory, "all"> {
  const text = row.name.toLowerCase();
  if (
    /искусственн.*интеллект|медицинских изделий с ии|ммг|ргк|флг|кт огк/u.test(
      text,
    )
  )
    return "ai";
  if (/лекарствен|лекарств|рецепт|фрлоз|фрлло|закупк|остатк/u.test(text))
    return "medicines";
  if (/врач|медицинск.*работник|электронн.*подпис|эп\b|подписавш/u.test(text))
    return "doctors";
  if (
    /твсп|кдл|станци[йи] смп|при[её]много отделения|передач[аи].*(?:сэмд|документ)|протокол.*(?:исследован|консилиум|ткм)|карта вызова/u.test(
      text,
    )
  )
    return "transfer";
  if (
    /епгу|личн.*кабинет|запис[ьи] на при[её]м|анкет граждан|справок онлайн|граждан, сведения|цифров.*услуг/u.test(
      text,
    )
  )
    return "services";
  if (
    (row.regionalId &&
      [
        "semd228",
        "hospital",
        "ambulatoryCase",
        "smp",
        "birth",
        "death",
        "elmk",
      ].includes(row.regionalId)) ||
    /сэмд|рэмд|регистр|фрмс|медицинск.*заключен|извещение|свидетельств/u.test(
      text,
    )
  )
    return "documents";
  return "integration";
}

function regionalControlStatus(
  row: FederalControlRow,
  alternate?: FederalControlRow,
): Exclude<ExtendedStatus, "all"> {
  if (row.regionalManualStatus === "reference") return "contract";
  if (row.regionalManualStatus === "achieved") return "achieved";
  if (row.regionalManualStatus === "notAchieved") return "notAchieved";
  if (row.regionalId && blockedIndicatorIds.has(row.regionalId))
    return "noData";
  const regional = row.regionalId
    ? calculatedIndicatorById[row.regionalId]
    : undefined;
  if (regional) {
    const status = statusFor(
      regional.fact,
      regional.plan,
      Boolean(regional.reverse),
    );
    return status === "good" ? "achieved" : "notAchieved";
  }
  const factText = row.regionalFact ?? alternate?.regionalFact;
  if (factText) {
    const fact = federalMetric(factText),
      plan = federalMetric(row.plan);
    if (fact.value !== null && plan.value !== null && fact.unit === plan.unit) {
      const achieved = federalLowerIsBetter(row)
        ? fact.value <= plan.value
        : fact.value >= plan.value;
      return achieved ? "achieved" : "notAchieved";
    }
  }
  if (row.status === "В контракте" || row.status === "Нет расчёта")
    return "contract";
  return "noData";
}

function strictIndicatorKey(row: FederalControlRow) {
  return row.regionalId
    ? `regional:${row.regionalId}`
    : `name:${row.name
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/giu, " ")
        .trim()}`;
}

function federalLowerIsBetter(row: FederalControlRow) {
  return (
    /(?:менее|не\s+более|≤)/iu.test(row.plan) ||
    /доля\s+(?:технических\s+)?ошиб/iu.test(row.name)
  );
}

function quantityDenominator(label?: string) {
  if (!label) return null;
  const match = label.match(/из\s+([\d\s]+)/iu);
  return match ? Number(match[1].replace(/\s/gu, "")) : null;
}

function snapshotDate(period: string) {
  return (
    period.match(/(\d{2}\.\d{2}\.\d{4})$/)?.[1] ??
    period.replace(/^на\s+/iu, "")
  );
}

function moSearchText(metric: string, row: MoRow) {
  const registry = registryOrganizationForMetric(metric, row);
  return [
    row.name,
    reportMoName(metric, row.name),
    registry?.shortName,
    ...(registry?.aliases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru");
}

function sourceDetailKey(name: string) {
  return name
    .replace(
      /^(?:Филиал\s+)?(?:ГАУЗ|ГБУЗ|ГБУ|ФГБУ|ФГАОУВО|ФГАОУ ВО|АО|ООО)(?:\s+РТ)?\s*/iu,
      "",
    )
    .replace(/["«»]/gu, "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function getMoDetail(metric: string, rowOrName: MoRow | string) {
  const row = typeof rowOrName === "string" ? null : rowOrName;
  const name = typeof rowOrName === "string" ? rowOrName : rowOrName.name;
  if (
    row &&
    typeof row.count === "number" &&
    typeof row.volume === "number"
  )
    return { registered: row.count, volume: row.volume };
  const metricDetails = moDetails[metric];
  if (!metricDetails) return undefined;
  if (row?.oid && moDetailOids[metric]?.[row.oid])
    return moDetailOids[metric][row.oid];
  const direct =
    metricDetails[moKey(name)] ?? metricDetails[sourceDetailKey(name)];
  if (direct) return direct;
  // Источники используют полные и сокращённые названия одной МО. Сопоставляем
  // только при единственном совпадении нормализованного ключа; номерные МО
  // разных типов (ГКБ, ДГКБ, ГП, ДГП) остаются разными.
  const target = moKey(name);
  const candidates = Object.entries(metricDetails).filter(
    ([key]) => moKey(key) === target,
  );
  if (candidates.length === 1) return candidates[0][1];
  // Числитель уже хранится в строке показателя. Для ненулевого факта можно
  // восстановить знаменатель без потери точности и не показывать ложный прочерк.
  if (row && typeof row.count === "number" && row.fact > 0) {
    return {
      registered: row.count,
      volume: Math.round((row.count * 100) / row.fact),
    };
  }
  return undefined;
}

function isTechnicalRow(name: string) {
  return /^\s*(?:итого|всего по|неизвестная МО)/iu.test(name);
}

function excludedFromAttention(name: string) {
  return /(?:^|\s)(?:ООО|АО|ИП|АНО)(?:\s|$)|ассоциация|частн(?:ая|ый|ое)|(?:^|\s)КСМ(?:\s|$)/iu.test(
    name,
  );
}

function isPrivateOrganization(name: string) {
  return /(?:^|\s)(?:ООО|АО|ПАО|ИП|АНО|МАНО|ЧУЗ|НОЧУ|НМЧУ)(?:\s|$)|общество\s+с\s+ограниченной\s+ответственностью|ассоциация|негосударственн|частн(?:ая|ый|ое)/iu.test(
    name,
  );
}

function isExcludedFromIndicators(name: string) {
  const normalized = name
    .replace(/[«»"']/g, " ")
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /(?:^|\s)КГМА(?=\s|$).*?(?:^|\s)РМАНПО(?=\s|$)/iu.test(normalized) ||
    /(?:^|\s)[АР]ЦОЗ\s+и\s+МП(?:\s|$)/iu.test(normalized) ||
    /(?:^|\s)Казанск(?:ий|ого)\s+ГМУ(?=\s|$).*?(?:^|\s)Минздрава\s+России/iu.test(
      normalized,
    )
  );
}

function isMaxProfileInapplicable(name: string) {
  const normalized = name.toLocaleLowerCase("ru");
  return /ркпд|противотуберкул|(?:^|\s)птд(?:\s|$)/iu.test(normalized);
}

function isUnavailableSourceRow(row: MoRow) {
  const warning = row.sourceWarning?.toLocaleLowerCase("ru") ?? "";
  return (
    warning.startsWith("нет строки в исходном перечне") ||
    warning.startsWith("нет строки в выгрузке") ||
    warning.startsWith("нет данных для корректного расчёта")
  );
}

function isPhysicianMetric(id: string) {
  return id === "doctorsAll" || id === "doctorsLevel3" || id.startsWith("doctor500_");
}

function isSmallPhysicianDenominator(id: string, row: MoRow) {
  return (
    indicatorRegistry.hasRowExclusion(id, "small_denominator_lt3_reference_only") &&
    (row.volume ?? 0) < 3
  );
}

type RatingBlock = "care" | "services" | "readiness";
type RankDetail = {
  id: string;
  name: string;
  fact: number;
  plan: number;
  score: number;
  previous: number | null;
  passed: boolean;
  block: RatingBlock;
  numerator: number | null;
  denominator: number | null;
};
type RankRow = {
  key: string;
  name: string;
  type: string;
  score: number | null;
  previousScore: number | null;
  change: number | null;
  passed: number;
  total: number;
  dataCount: number;
  missing: string[];
  coverage: number;
  blocks: Record<RatingBlock, number | null>;
  details: RankDetail[];
};
type RatingSortKey =
  | "place"
  | "name"
  | "score"
  | "care"
  | "services"
  | "readiness"
  | "passed"
  | "change"
  | "coverage"
  | "status";
type HearingMetric = {
  id: string;
  name: string;
  fact: number | null;
  previous: number | null;
  plan: number | null;
  unit: string;
  date: string;
  period: string;
  count: number | null;
  volume: number | null;
  applicable: boolean;
  affectsPriority: boolean;
  passed: boolean | null;
  persistent: boolean;
  adverseChange: boolean;
  score: number | null;
  detail?: string;
  targetCount?: number | null;
  deficitCount?: number | null;
  regionalDenominator?: number | null;
  regionalContribution?: number | null;
  status: "good" | "bad" | "reference" | "missing";
};
type HearingRow = {
  key: string;
  name: string;
  type: string;
  priority: number;
  severity: number;
  persistence: number;
  breadth: number;
  scale: number;
  decline: number;
  failedCount: number;
  persistentCount: number;
  missingCount: number;
  dataCount: number;
  total: number;
  coverage: number;
  quantityGap: number;
  regionalContribution: number;
  mainProblem: HearingMetric | null;
  level: "mandatory" | "control";
  heard: boolean;
  metrics: HearingMetric[];
};
type HearingSnapshotMetric = {
  name: string;
  fact: number | null;
  previous: number | null;
  plan: number | null;
  unit: string;
  date: string;
  period: string;
  count: number | null;
  volume: number | null;
};
type HearingSnapshotData = {
  fixedAt: string;
  sourceCommit: string;
  note: string;
  organizations: Record<
    string,
    { name: string; fixedAt?: string; sourceCommit?: string; metrics: Record<string, HearingSnapshotMetric> }
  >;
};
const hearingSnapshots = hearingSnapshotsRaw as HearingSnapshotData;

function hearingMetricChange(rowKey: string, metric: HearingMetric) {
  const baseline = hearingSnapshots.organizations[rowKey]?.metrics[metric.id];
  if (!baseline || baseline.fact === null || metric.fact === null)
    return { baseline, change: null, direction: "na" as const };
  const change = metric.fact - baseline.fact;
  if (Math.abs(change) < 0.005)
    return { baseline, change: 0, direction: "same" as const };
  const reverse =
    moData[metric.id]?.direction === "lower" ||
    calculatedIndicatorById[metric.id]?.reverse === true;
  return {
    baseline,
    change,
    direction: (reverse ? change < 0 : change > 0)
      ? ("improved" as const)
      : ("worsened" as const),
  };
}

function hearingSnapshotSummary(row: HearingRow) {
  const comparable = row.metrics
    .map((metric) => hearingMetricChange(row.key, metric))
    .filter((item) => item.change !== null);
  return {
    snapshot: hearingSnapshots.organizations[row.key],
    improved: comparable.filter((item) => item.direction === "improved").length,
    worsened: comparable.filter((item) => item.direction === "worsened").length,
    same: comparable.filter((item) => item.direction === "same").length,
    comparable: comparable.length,
  };
}

type HearingChangeFilter = "all" | "worsened" | "improved" | "same";
type HearingDisplayGroup = {
  code: "semd" | "tvsp" | "doctors" | "egpu" | "technology" | "reference";
  label: string;
  order: number;
};

const hearingDisplayGroups: Record<HearingDisplayGroup["code"], HearingDisplayGroup> = {
  semd: { code: "semd", label: "СЭМД относительно случаев / обращений", order: 1 },
  tvsp: { code: "tvsp", label: "ТВСП", order: 2 },
  doctors: { code: "doctors", label: "Врачи / электронная подпись / 500+", order: 3 },
  egpu: { code: "egpu", label: "ЕПГУ и цифровые сервисы", order: 4 },
  technology: { code: "technology", label: "Прочие количественные / технологические показатели", order: 5 },
  reference: { code: "reference", label: "Справочные / неприменимые / без сопоставимого плана / без необходимых данных", order: 6 },
};

function hearingDisplayGroup(metric: HearingMetric): HearingDisplayGroup {
  if (
    metric.applicable === false ||
    metric.status === "missing" ||
    !metric.affectsPriority ||
    metric.regionalContribution === null ||
    metric.regionalContribution === undefined
  ) return hearingDisplayGroups.reference;
  if (["hospital", "ambulatoryCase", "semd228", "smp"].includes(metric.id)) return hearingDisplayGroups.semd;
  if (["tvspStationary", "tvspAmbulatory", "tvspLaboratory", "tvspDiagnostic", "smpFederal"].includes(metric.id)) return hearingDisplayGroups.tvsp;
  if (metric.id === "doctorsLevel3" || metric.id === "doctorsAll" || metric.id.startsWith("doctor500_")) return hearingDisplayGroups.doctors;
  if (["egpu", "egpu2days"].includes(metric.id)) return hearingDisplayGroups.egpu;
  return hearingDisplayGroups.technology;
}

function hearingMetricWithinGroupOrder(metric: HearingMetric) {
  const explicit = [
    "hospital", "ambulatoryCase", "semd228", "smp",
    "tvspStationary", "tvspAmbulatory", "tvspLaboratory", "tvspDiagnostic", "smpFederal",
    "doctor500_surgeon", "doctorsLevel3", "doctorsAll",
    "egpu", "egpu2days",
  ];
  const index = explicit.indexOf(metric.id);
  return index === -1 ? 10_000 : index;
}

function hearingMetricsForDisplay(
  row: HearingRow,
  filter: HearingChangeFilter,
) {
  return [...row.metrics]
    .filter(
      (metric) =>
        filter === "all" ||
        hearingMetricChange(row.key, metric).direction === filter,
    )
    .sort(
      (a, b) => {
        const groupDifference = hearingDisplayGroup(a).order - hearingDisplayGroup(b).order;
        if (groupDifference) return groupDifference;
        const priorityDifference = Number(b.affectsPriority) - Number(a.affectsPriority);
        if (priorityDifference) return priorityDifference;
        const contributionDifference = (b.regionalContribution ?? -1) - (a.regionalContribution ?? -1);
        if (Math.abs(contributionDifference) > 0.000001) return contributionDifference;
        const explicitDifference = hearingMetricWithinGroupOrder(a) - hearingMetricWithinGroupOrder(b);
        return explicitDifference || a.name.localeCompare(b.name, "ru");
      },
    );
}

function hearingMetricGroupsForDisplay(row: HearingRow, filter: HearingChangeFilter) {
  const metrics = hearingMetricsForDisplay(row, filter);
  return Object.values(hearingDisplayGroups)
    .map((group) => ({ group, metrics: metrics.filter((metric) => hearingDisplayGroup(metric).code === group.code) }))
    .filter((item) => item.metrics.length > 0);
}

const versionHistory = [
  {
    version: "5.2.5",
    date: "09.09.2026",
    items: [
      "В раздел МАХ добавлены компактные официальные плашки РТ; они отделены от оперативного мониторинга МО и не используются для недельной динамики.",
      "Внесены вручную согласованные факты РТ с пометкой о последующей замене первичными отчётами; период в рабочей таблице приведён к 2026 году.",
      "Для врачебных показателей применимость определяется уровнем МО и наличием соответствующей должности в выгрузке; ЕПГУ получил корректную оперативную динамику 31.08 → 07.09.",
    ],
  },
  {
    version: "5.2.4",
    date: "09.09.2026",
    items: [
      "Карточки раздела «МО для заслушивания» сгруппированы в фиксированном управленческом порядке; расчёт приоритета и baseline заслушанных МО не менялись.",
      "Добавлены подтверждённые факты РТ: регистрация СЭМД в первые сутки за полный август и количество СЭМД «Льготный рецепт» на 07.09.",
      "GitHub Pages workflow проверяет и публикует только зафиксированный исходный код, не изменяя его во время deployment.",
    ],
  },
  {
    version: "5.2.0",
    date: "08.09.2026",
    items: [
      "Добавлен отдельный фактический блок «Запись на приём к врачу через МАХ» по муниципалитетам за апрель–сентябрь 2026 года.",
      "Привязка записи к медицинским организациям не выполняется: источник содержит только муниципалитет и месяц.",
      "Из помесячной таблицы МО в разделе МАХ убрана запись к врачу; на уровне МО сохранены только ТМК и ЛВН с подтверждённой привязкой.",
    ],
  },
  {
    version: "5.0.0",
    date: "08.09.2026",
    items: [
      "Создан отдельный раздел «МАХ»: годовое исполнение РТ отделено от месячной активности медицинских организаций.",
      "Для ТМК и ЛВН показан полный август как разность накопительных срезов 31.07 → 31.08; июль и месячная запись не рассчитываются без недостающих граничных срезов.",
      "Пользовательское наименование третьего показателя: «Запись к врачу посредством МАХ»; техническое название столбца источника сохранено в методике.",
    ],
  },
  {
    version: "4.7.0",
    date: "08.09.2026",
    items: [
      "Оперативные показатели обновлены по сопоставимым выгрузкам на 07.09.2026; месячный рейтинг сохранён по полному августу.",
      "Ошибки регистрации СЭМД заменены отчётом за август: 785 939 ошибок, 32 категории, 213 организаций/источников; доля не рассчитывается без знаменателя.",
      "Для заслушанных МО восстановлены отдельные контрольные даты и динамика; отсутствующие строки нового среза показаны как «Нет строки в выгрузке на 07.09.2026».",
    ],
  },
  {
    version: "4.6.2",
    date: "08.09.2026",
    items: [
      "Ошибки федеральной регистрации СЭМД выделены в основной раздел «Ошибки РЭМД».",
      "Методологические и расчётные замечания сохранены в отдельном разделе «Ошибки методик».",
      "В пользовательских названиях разделов сокращение «МО» заменено на «медицинские организации».",
    ],
  },
  {
    version: "4.6.1",
    date: "07.09.2026",
    items: [
      "Внутренняя архитектура оптимизирована без изменения утверждённых данных, формул, периодов, рейтинга и логики заслушиваний.",
      "Раздел «Категории ошибок регистрации СЭМД» дополнен разрезом по МО и взаимным drill-down «категория ↔ МО»; абсолютные ошибки не трактуются как доля или рейтинг качества.",
      "Добавлены единые реестры показателей/МО, автоматический движок периодов, calculation layer, PASS/WARNING/FAIL validation и staging-конвейер обновления 20/20 семейств отчётов.",
    ],
  },
  {
    version: "4.6.0",
    date: "07.09.2026",
    items: [
      "Рейтинг переведён на август 2026 с динамикой к июлю; июнь исключён из текущего сравнения.",
      "Накопительные показатели ТВСП включены по актуальному срезу; отсутствие строки больше не подменяется нулём баллов.",
      "Исправлено сопоставление ДГП №6 Казани и Набережных Челнов; планы МАХ обозначены как годовые, оперативный факт — отдельный сентябрьский срез.",
    ],
  },
  {
    version: "4.5.0",
    date: "07.09.2026",
    items: [
      "Полные периоды приведены к единой логике: июль и август 2026; старые недельные срезы больше не выдаются за месячные данные.",
      "Профилактика пересчитана по федеральной переходной формуле MAX(СЭМД 122; 228) отдельно по каждой МО: 1 514 789 из 2 012 724, или 75,26%; детство включено.",
      "Для врачей и 500+ показана фактическая динамика июля к августу; неполный сентябрь исключён. Оперативные итоги МАХ обновлены на 07.09.2026.",
    ],
  },
  {
    version: "4.4.0",
    date: "07.09.2026",
    items: [
      "Загружен полный августовский срез по врачам: 125 МО и 726 строк по специальностям; неполный сентябрь исключён.",
      "В месячный рейтинг МО добавлены августовские показатели врачей и 500+; сравнение с июлем будет доступно после загрузки полного июля.",
      "Показатель профилактических осмотров пересчитан по 96 МО с учётом детства: 1 476 474 из 1 747 644, или 84,48%.",
    ],
  },
  {
    version: "4.3.1",
    date: "04.09.2026",
    items: [
      "В карточках показателей блок действий МО свёрнут по умолчанию; ниже добавлен отдельный блок методики расчёта с формулой, числителем, знаменателем, источником, периодом и условиями расчёта.",
      "В статус «Заслушаны» добавлены ГП № 7 Набережных Челнов и ДРКБ МЗ РТ.",
      "Для запланированного показателя автоматизированного формирования СЭМД «Экстренное извещение об инфекционном заболевании» сохранён статус «В контракте».",
    ],
  },
  {
    version: "4.3.0",
    date: "02.09.2026",
    items: [
      "Загружен федеральный отчёт по активности врачей в РЭМД за август 2026 года: проверены 125 МО общего отчёта и 116 МО в разрезе специальностей.",
      "Добавлены 11 месячных показателей: все врачи, врачи МО III уровня и девять специальностей с объёмом свыше 500 СЭМД.",
      "Каждая специальность отдельно влияет на приоритет МО для заслушивания; при наличии 1–2 врачей результат показывается справочно.",
      "В статус «Заслушаны» добавлены Спасская ЦРБ, ДСП № 6 Казани, Сармановская ЦРБ, Муслюмовская ЦРБ и Альметьевская ГП № 3.",
      "Поиск МО расширен полными названиями, сокращениями и псевдонимами, включая Спасскую ЦРБ и ДСП № 6 Казани.",
    ],
  },
  {
    version: "4.2.0",
    date: "01.09.2026",
    items: [
      "Обновлён показатель амбулаторного эпикриза по отчёту за 01.01–29.08.2026, сформированному 31.08.2026.",
      "Факт по РТ пересчитан: 9 549 272 СЭМД из 10 948 601 случая — 87,22%, улучшение на 2,10 п.п. к срезу 21.08.2026.",
      "Обновлены 143 строки МО, динамика, лидеры и перечень требующих внимания; частные МО по-прежнему исключены из управленческого списка отстающих.",
      "Зафиксированы особенности источника: 24 пустых числителя, одна строка без OID и один повторяющийся OID.",
      "Пересчитан показатель профилактических осмотров за 01.01–28.08.2026: MAX(СЭМД 122; СЭМД 228) выбран отдельно по 78 взрослым МО; результат — 1 127 186 из 1 350 058, или 83,49%.",
      "Детские МО не включены в полученный источник и не оцениваются до перевыгрузки; динамика к прежнему файлу отключена как несопоставимая.",
      "В разделе 09 добавлены практические маршруты формирования СЭМД в МИС Витакор для долевых показателей СЭМД.",
      "В разделе 02 для каждого федерального показателя добавлен тип расчётного периода: накопительный, месячный либо состояние на отчётную дату.",
      "Название профилактического показателя сокращено до «Доля СЭМД (122/228) профилактического осмотра (диспансеризации)»; служебная плашка источника убрана с основной страницы.",
      "В методиках зафиксированы согласованные правила доверия к источникам: «Принято» АСУ СМП и «Зарег» отчёта 122/228 признаются регистрацией в РЭМД; статусы свидетельств из ГИС ЭЗ РТ принимаются как федеральная регистрация.",
      "Для амбулаторного эпикриза случаи ПМСП, поданные на оплату, закреплены как доступный рабочий знаменатель до получения отдельной выгрузки завершённых случаев.",
    ],
  },
  {
    version: "4.1.3",
    date: "31.08.2026",
    items: [
      "Возвращён оперативный показатель СЭМД 228 для взрослых МО; детские МО показаны справочно и исключены из оценки до загрузки СЭМД 122.",
      "Федеральный расчёт MAX(СЭМД 122; СЭМД 228) сохранён отдельно и не подменяется расчётом только по СЭМД 228.",
      "Таблица переходного контроля СЭМД сделана компактнее.",
      "Добавлена сортировка таблицы ЭПЛ по изменению доли движения к предыдущей неделе.",
    ],
  },
  {
    version: "4.1.2",
    date: "31.08.2026",
    items: [
      "Повторно разобраны отчёты ЭПЛ за 17.08–23.08.2026 и 24.08–30.08.2026: обе недели приведены к одинаковым 126 группам и 171 строке подразделений.",
      "Исправлены названия десяти объединённых групп ЭПЛ: показатели больше не отображаются под названием первой строки или первого филиала.",
      "В таблицу ЭПЛ добавлена динамика к предыдущей неделе по доле движения и количеству ТС с движением; состав объединённых групп раскрывается до подразделений.",
      "На карточках расширенной сводки добавлено управленческое направление недельной динамики: улучшение, ухудшение или отсутствие изменения.",
    ],
  },
  {
    version: "4.1.1",
    date: "31.08.2026",
    items: [
      "Обновлён отчёт «Электронный путевой лист» за 24.08–30.08.2026: недельные итоги, движение ТС, путевые листы и детализация организаций.",
      "Обновлён отчёт «Случаи краткого ввода» за 01.01–28.08.2026 (выгрузка 28.08.2026): общий, амбулаторный и стационарный блоки.",
      "Исправлен разбор дочерних строк ЭПЛ без номера; региональные итоги теперь совпадают с итоговой строкой источника.",
      "«Рейтинг МО» перенесён в блок «В разработке», журнал ошибок дополнен влиянием, временным правилом и требуемым уточнением.",
      "Предварительная выгрузка врачей 501+ СЭМД от 31.08.2026 проанализирована, но не загружена до получения закрытого месяца.",
    ],
  },
  {
    version: "4.1.0",
    date: "31.08.2026",
    items: [
      "Загружены госпитализации и данные ФАП/ФП по 29.08.2026.",
      "Исправлено пропущенное обновление карт вызова СМП по отчёту АСУ СМП на 28.08.2026.",
      "Выполнена повторная сверка дат, периодов и контрольных итогов по всем актуальным источникам.",
    ],
  },
  {
    version: "4.0.0",
    date: "29.08.2026",
    items: [
      "Добавлен раздел «История обновлений».",
      "Перестроена навигация: рабочие разделы отделены от разделов в разработке.",
      "В заслушанных МО усилено отображение улучшений и ухудшений, добавлена фильтрация динамики.",
      "Отсутствие строки по свидетельствам о смерти показывается как «Нет данных» и не считается невыполнением.",
    ],
  },
  {
    version: "3.5.3",
    date: "29.08.2026",
    items: [
      "Восстановлены контрольные снимки пяти заслушанных МО на 25.08.2026 14:13 МСК.",
      "Добавлено сравнение 18–19 показателей каждой МО с актуальным срезом.",
      "Первичный осмотр врачом приёмного отделения перенесён в группу ТВСП и передачи документов.",
      "Уточнена формулировка отсутствующего регионального расчёта.",
    ],
  },
  {
    version: "3.5.2",
    date: "29.08.2026",
    items: [
      "В расширенной сводке добавлены семь смысловых групп показателей.",
      "Добавлена фильтрация карточек по группе показателей.",
      "Выровнена карточка «Госпитализации».",
    ],
  },
  {
    version: "3.5.1",
    date: "29.08.2026",
    items: [
      "Разделены федеральное выполнение и выполнение по актуальным данным РТ.",
      "Исправлены счётчики расширенной сводки.",
      "Показатели врачей с 500+ СЭМД переведены на месячный расчёт.",
      "План технических ошибок записи через ЕПГУ установлен не более 5%.",
      "Введена схема версионности дашборда.",
    ],
  },
];

const heardOrganizationOids = new Set([
  "1.2.643.5.1.13.13.12.2.16.1161", // Базарно-Матакская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.1149", // Лаишевская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.44921", // Альметьевская РМБ
  "1.2.643.5.1.13.13.12.2.16.1088", // Агрызская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.1133", // Рыбно-Слободская ЦРБ
  "context:spassk-crb", // Спасская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.1150", // ДСП № 6 Казани
  "1.2.643.5.1.13.13.12.2.16.1169", // Сармановская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.1055", // Муслюмовская ЦРБ
  "1.2.643.5.1.13.13.12.2.16.1107", // Альметьевская ГП № 3
  "1.2.643.5.1.13.13.12.2.16.1115", // ГП № 7 Набережных Челнов
  "1.2.643.5.1.13.13.12.2.16.1155", // ДРКБ МЗ РТ
]);

type UnionDefinition = {
  name: string;
  curatorOids: string[];
  districts: string[];
};
type UnionRatingRow = {
  name: string;
  score: number | null;
  median: number | null;
  change: number | null;
  coverage: number;
  members: RankRow[];
  rated: number;
  leaders: number;
  attention: number;
  provisional: boolean;
};
const unionDefinitions: UnionDefinition[] = [
  {
    name: "БСМП",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.1040"],
    districts: [
      "Агрызский",
      "Актанышский",
      "Елабужский",
      "Менделеевский",
      "Мензелинский",
      "Тукаевский",
      "Набережные челны",
    ],
  },
  {
    name: "АММБ",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.44921"],
    districts: [
      "Азнакаевский",
      "Альметьевский",
      "Бавлинский",
      "Бугульминский",
      "Муслюмовский",
      "Сармановский",
      "Ютазинский",
    ],
  },
  {
    name: "РКБ",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.1094"],
    districts: [
      "Аксубаевский",
      "Алексеевский",
      "Алькеевский",
      "Лаишевский",
      "Лениногорский",
      "Новошешминский",
      "Рыбно-Слободский",
      "Спасский",
      "Черемшанский",
      "Чистопольский",
    ],
  },
  {
    name: "ГКБ №7",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.1163"],
    districts: [
      "Апастовский",
      "Буинский",
      "Верхнеуслонский",
      "Высокогорский",
      "Дрожжановский",
      "Зеленодольский",
      "Кайбицкий",
      "Камско-Устьинский",
      "Пестречинский",
      "Тетюшский",
    ],
  },
  {
    name: "МКДЦ",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.1079"],
    districts: [
      "Арский",
      "Атнинский",
      "Балтасинский",
      "Кукморский",
      "Мамадышский",
      "Нурлатский",
      "Сабинский",
      "Тюлячинский",
    ],
  },
  {
    name: "НЦРМБ",
    curatorOids: ["1.2.643.5.1.13.13.12.2.16.1192"],
    districts: ["Заинский", "Нижнекамский"],
  },
];

function canonicalDistrict(value: string | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^а-я]+/g, "")
    .replace("лаишевскй", "лаишевский")
    .replace("рыбнослободской", "рыбнослободский");
}

function buildUnionRating(rows: RankRow[]): UnionRatingRow[] {
  const orgByOid = new Map(
    moRegistry.organizations.map((org) => [org.oid, org]),
  );
  return unionDefinitions
    .map((definition) => {
      const districts = new Set(definition.districts.map(canonicalDistrict));
      const curatorOids = new Set(definition.curatorOids);
      const members = rows
        .filter((row) => {
          const org = orgByOid.get(row.key);
          return (
            Boolean(org) &&
            !curatorOids.has(row.key) &&
            districts.has(canonicalDistrict(org?.district))
          );
        })
        .sort(
          (a, b) =>
            (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
            b.coverage - a.coverage ||
            a.name.localeCompare(b.name, "ru"),
        );
      const scored = members.filter((row) => row.score !== null);
      const scores = scored
        .map((row) => row.score as number)
        .sort((a, b) => a - b);
      const score = scores.length
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : null;
      const middle = Math.floor(scores.length / 2);
      const median = scores.length
        ? scores.length % 2
          ? scores[middle]
          : (scores[middle - 1] + scores[middle]) / 2
        : null;
      const comparable = scored.filter((row) => row.change !== null);
      const change = comparable.length
        ? comparable.reduce((sum, row) => sum + (row.change ?? 0), 0) /
          comparable.length
        : null;
      const expected = members.reduce((sum, row) => sum + row.total, 0);
      const received = members.reduce((sum, row) => sum + row.dataCount, 0);
      const coverage = (received / Math.max(1, expected)) * 100;
      return {
        name: definition.name,
        score,
        median,
        change,
        coverage,
        members,
        rated: scored.length,
        leaders: scored.filter((row) => (row.score ?? 0) >= 95).length,
        attention: scored.filter((row) => (row.score ?? 100) < 80).length,
        provisional: coverage < 80,
      };
    })
    .sort(
      (a, b) =>
        (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
        b.leaders / Math.max(1, b.rated) - a.leaders / Math.max(1, a.rated) ||
        a.attention - b.attention ||
        b.coverage - a.coverage ||
        a.name.localeCompare(b.name, "ru"),
    );
}

function applicableForRegistry(registry: RegistryOrganization, id: string) {
  if (id === "doctorsLevel3") return registry.level === "III уровень";
  if (isPhysicianMetric(id)) {
    const physicianDataset = physicianMetrics.datasets[id];
    const physicianRow = physicianDataset?.rows?.find(
      (row) => row.oid === registry.oid,
    );
    // Отсутствие специальности в выгрузке не означает невыполнение: у МО нет
    // соответствующей должности либо показатель неприменим к её профилю.
    return Boolean(physicianRow && (physicianRow.volume ?? 0) > 0);
  }
  if (registry.oid === "context:spassk-crb")
    return spasskCrbReportMetrics.has(id);
  if (
    registry.oid === "1.2.643.5.1.13.13.12.2.16.1094" &&
    spasskCrbReportMetrics.has(id)
  )
    return false;
  return registry.applicable.includes(id);
}

function evaluableForRegistry(registry: RegistryOrganization, id: string) {
  return (
    applicableForRegistry(registry, id) &&
    !(
      id === "semd228" &&
      preventiveSemdAudit.summary.status === "blocked" &&
      preventiveChildOids.has(registry.oid)
    )
  );
}

function ratingBlock(id: string): RatingBlock {
  return indicatorRegistry.ratingBlock(id) as RatingBlock;
}

const ratingWeights: Record<RatingBlock, number> = {
  care: indicatorRegistry.ratingWeight("care"),
  services: indicatorRegistry.ratingWeight("services"),
  readiness: indicatorRegistry.ratingWeight("readiness"),
};
function weightedRating(
  details: RankDetail[],
  applicable: string[],
  previous = false,
) {
  const blocks: Record<RatingBlock, number | null> = {
    care: null,
    services: null,
    readiness: null,
  };
  (Object.keys(blocks) as RatingBlock[]).forEach((block) => {
    const expected = applicable.filter((id) => ratingBlock(id) === block);
    if (!expected.length) return;
    const values = expected.flatMap((id) => {
      const detail = details.find((item) => item.id === id);
      // Отсутствие строки не подменяется нулевым результатом: показатель
      // остаётся в контроле полноты, но не искажает балл МО.
      if (!detail) return [];
      if (!previous) return [detail.score];
      if (detail.previous === null) return [];
      return [scoreAgainstPlan({
        fact: detail.previous,
        plan: detail.plan,
        direction: indicatorRegistry.direction(detail.id),
      }) ?? 0];
    });
    if (values.length)
      blocks[block] = values.reduce((s, v) => s + v, 0) / values.length;
  });
  const available = (Object.keys(blocks) as RatingBlock[]).filter(
    (block) => blocks[block] !== null,
  );
  if (!available.length) return { score: null, blocks };
  const weight = available.reduce((s, block) => s + ratingWeights[block], 0);
  const score =
    available.reduce(
      (s, block) => s + (blocks[block] ?? 0) * ratingWeights[block],
      0,
    ) / Math.max(weight, 0.0001);
  return { score, blocks };
}

function buildOrganizationRating(): RankRow[] {
  // Основной рейтинг строится только по последнему полностью завершённому
  // месяцу. Августовские накопительные срезы остаются в разделе показателей
  // и не влияют на место МО.
  // Legacy baseline anchor (v4.6.0): Август|31\.08|28\.08|29\.08.
  const eligibleIds = new Set(
    Object.entries(monthlyMoData)
      .filter(
        ([id, dataset]) =>
          dataset.unit === "%" &&
          datasetBelongsToReportingMonth(
            dataset,
            latestFullMonth,
          ) &&
          indicatorRegistry.plan(id, moData[id]?.plan ?? null) !== null &&
          indicatorRegistry.canEnterRating(id) &&
          !blockedIndicatorIds.has(id),
      )
      .map(([id]) => id),
  );
  const byOrg = new Map<
    string,
    { registry: RegistryOrganization; details: RankDetail[] }
  >();
  [...moRegistry.organizations, spasskCrbOrganization]
    .filter((org) => org.type !== "Вне рейтинга")
    .forEach((org) => byOrg.set(org.oid, { registry: org, details: [] }));
  Object.entries(monthlyMoData).forEach(([id, dataset]) => {
    if (!eligibleIds.has(id)) return;
    const plan = indicatorRegistry.plan(id, moData[id]?.plan ?? null);
    if (plan === null || plan === undefined) return;
    const direction = indicatorRegistry.direction(id);
    const reverse =
      direction === "lower" || calculatedIndicatorById[id]?.reverse === true;
    dataset.rows.forEach((row) => {
      if (row.july === null) return;
      if (excludedFromAttention(row.name) || isTechnicalRow(row.name)) return;
      const registry = registryOrganizationByMetricAndName(id, row.name);
      if (!registry || !evaluableForRegistry(registry, id)) return;
      const item = byOrg.get(registry.oid);
      if (!item) return;
      const score = scoreAgainstPlan({
        fact: row.july,
        plan,
        direction,
        reverse,
      }) ?? 0;
      const quantity = parseQuantityPair(row.julyQuantity);
      const numerator = quantity?.numerator ?? null;
      const denominator = quantity?.denominator ?? null;
      item.details.push({
        id,
        name: moData[id]?.name ?? id,
        fact: row.july,
        plan,
        score,
        previous: row.june,
        passed: passedPlan({
          fact: row.july,
          plan,
          direction,
          reverse,
        }) ?? false,
        block: ratingBlock(id),
        numerator,
        denominator,
      });
    });
  });
  return [...byOrg.values()].map((item) => {
    const applicable = [...eligibleIds].filter((id) =>
      evaluableForRegistry(item.registry, id),
    );
    const availableIds = new Set(item.details.map((detail) => detail.id));
    const missing = applicable
      .filter((id) => !availableIds.has(id))
      .map((id) => moData[id]?.name ?? id);
    const current = weightedRating(item.details, applicable);
    const score = item.details.length ? current.score : null;
    const hasComparablePrevious =
      item.details.length === applicable.length &&
      item.details.every((d) => d.previous !== null);
    const previous = hasComparablePrevious
      ? weightedRating(item.details, applicable, true)
      : null;
    const change =
      score === null || previous?.score === null || previous === null
        ? null
        : score - previous.score;
    return {
      key: item.registry.oid,
      name: item.registry.shortName,
      type: item.registry.type,
      score,
      previousScore: previous?.score ?? null,
      change,
      passed: item.details.filter((d) => d.passed).length,
      total: applicable.length,
      dataCount: item.details.length,
      missing,
      coverage: (item.details.length / Math.max(1, applicable.length)) * 100,
      blocks: current.blocks,
      details: item.details.sort((a, b) => a.score - b.score),
    };
  });
}

export default function Home() {
  const [tab, setTab] = useState<
    | "summary"
    | "unified"
    | "max"
    | "federal"
    | "matrix"
    | "ranking"
    | "hearings"
    | "incident38"
    | "waybill"
    | "semd"
    | "remdErrors"
    | "errors"
    | "methods"
    | "history"
  >("unified");
  const [maxMonth, setMaxMonth] = useState<"2026-07" | "2026-08">("2026-08");
  const [maxService, setMaxService] = useState<"visit" | "tmk" | "eln">("visit");
  const [maxFilter, setMaxFilter] = useState<"volume" | "growth" | "decline" | "zero" | "missing">("volume");
  const [maxSelectedMo, setMaxSelectedMo] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [group, setGroup] = useState("Все направления");
  const [query, setQuery] = useState("");
  const [matrixMetric, setMatrixMetric] = useState("egpu");
  const [metricQuery, setMetricQuery] = useState("");
  const [moStatus, setMoStatus] = useState("all");
  const [moOwnership, setMoOwnership] = useState<"state" | "all">("state");
  const [moSortKey, setMoSortKey] = useState<MoSortKey>("fact");
  const [moSortDirection, setMoSortDirection] = useState<SortDirection>("desc");
  const [semdQuery, setSemdQuery] = useState("");
  const [semdOnlyRegistered, setSemdOnlyRegistered] = useState(true);
  const [errorView, setErrorView] = useState<"categories" | "organizations">(
    "categories",
  );
  const [selectedErrorCategory, setSelectedErrorCategory] = useState<string | null>(null);
  const [selectedErrorOrganization, setSelectedErrorOrganization] = useState<string | null>(null);
  const [errorOrganizationQuery, setErrorOrganizationQuery] = useState("");
  const [semdSortKey, setSemdSortKey] = useState<
    "name" | "format" | "count" | "share"
  >("count");
  const [semdSortDirection, setSemdSortDirection] =
    useState<SortDirection>("desc");
  const [dynamicsMode, setDynamicsMode] = useState<"week" | "month">("week");
  const [methodQuery, setMethodQuery] = useState("");
  const [federalSet, setFederalSet] = useState<"agreement" | "collegium">(
    "agreement",
  );
  const [federalStatus, setFederalStatus] = useState("all");
  const [federalQuery, setFederalQuery] = useState("");
  const [unifiedMode, setUnifiedMode] = useState<"compact" | "detail">(
    "compact",
  );
  const [unifiedScope, setUnifiedScope] = useState<
    "all" | "rf" | "rt" | "both"
  >("all");
  const [unifiedQuery, setUnifiedQuery] = useState("");
  const [unifiedSelected, setUnifiedSelected] = useState("regional-egpu");
  const [extendedCategory, setExtendedCategory] =
    useState<ExtendedCategory>("all");
  const [extendedStatusFilter, setExtendedStatusFilter] =
    useState<ExtendedStatus>("all");
  const [extendedReturn, setExtendedReturn] = useState<{
    point: string;
    scrollY: number;
  } | null>(null);
  const [showMatrixSections, setShowMatrixSections] = useState(false);
  const [unitQuery, setUnitQuery] = useState("");
  const [unitStatus, setUnitStatus] = useState("all");
  const [unitSortKey, setUnitSortKey] = useState<
    "mo" | "unit" | "count" | "status"
  >("status");
  const [unitSortDirection, setUnitSortDirection] =
    useState<SortDirection>("asc");
  const ratingRows = useMemo(() => buildOrganizationRating(), []);
  const [hearingLevel, setHearingLevel] = useState<
    "all" | "mandatory" | "control" | "heard"
  >("all");
  const [hearingType, setHearingType] = useState("Все типы МО");
  const [hearingQuery, setHearingQuery] = useState("");
  const [hearingChangeFilter, setHearingChangeFilter] =
    useState<HearingChangeFilter>("all");
  const visibleMaxRows = useMemo(() => {
    if (maxMonth === "2026-07") return [] as MaxMonthlyRow[];
    const rows = [...augustMaxRows];
    const serviceValue = (row: MaxMonthlyRow) =>
      maxService === "tmk" ? row.tmk : row.eln;
    const missing = (row: MaxMonthlyRow) => serviceValue(row).status === "missing";
    const zero = (row: MaxMonthlyRow) =>
      serviceValue(row).status !== "unavailable" && serviceValue(row).value === 0;
    if (maxFilter === "missing") return rows.filter(missing).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "zero") return rows.filter(zero).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (maxFilter === "growth" || maxFilter === "decline") return rows.filter(() => false);
    return rows.sort((a, b) => (serviceValue(b).value ?? 0) - (serviceValue(a).value ?? 0));
  }, [maxMonth, maxFilter, maxService]);
  const selectedMaxRow = augustMaxRows.find((row) => row.name === maxSelectedMo) ?? null;
  const hearingRows = useMemo<HearingRow[]>(() => {
    const registrationErrorsByOid = new Map(
      (errorCategories.organizationBreakdown?.organizations ?? [])
        .filter((organization) => organization.oid)
        .map((organization) => [organization.oid as string, organization]),
    );
    const byOrg = new Map<
      string,
      { registry: RegistryOrganization; metrics: HearingMetric[] }
    >();
    [...moRegistry.organizations, spasskCrbOrganization]
      .filter((org) => org.type !== "Вне рейтинга")
      .forEach((registry) =>
        byOrg.set(registry.oid, { registry, metrics: [] }),
      );
    Object.entries(moData).forEach(([id, dataset]) =>
      dataset.rows.forEach((row) => {
        if (isTechnicalRow(row.name) || excludedFromAttention(row.name)) return;
        const registry = registryOrganizationForMetric(id, row);
        if (!registry || registry.type === "Вне рейтинга") return;
        const owner = byOrg.get(registry.oid);
        if (!owner) return;
        const applicable = applicableForRegistry(registry, id);
        const direction = indicatorRegistry.direction(id);
        const reverse =
          direction === "lower" || calculatedIndicatorById[id]?.reverse === true;
        const hasPersonalPlan =
          dataset.plan !== null &&
          indicatorRegistry.affectsHearingPriority(id) &&
          !blockedIndicatorIds.has(id) &&
          evaluableForRegistry(registry, id) &&
          !isUnavailableSourceRow(row) &&
          !isSmallPhysicianDenominator(id, row);
        const plan = hasPersonalPlan ? dataset.plan : null;
        const passed =
          plan === null ? null : reverse ? row.fact <= plan : row.fact >= plan;
        const previousPassed =
          plan === null || row.previous === null
            ? null
            : reverse
              ? row.previous <= plan
              : row.previous >= plan;
        const score =
          plan === null
            ? null
            : reverse
              ? row.fact <= 0
                ? 100
                : Math.min(100, (plan / Math.max(row.fact, 0.0001)) * 100)
              : Math.min(100, (row.fact / Math.max(plan, 0.0001)) * 100);
        const detail = getMoDetail(id, row);
        owner.metrics.push({
          id,
          name: dataset.name,
          fact: row.fact,
          previous: row.previous,
          plan,
          unit: dataset.unit,
          date: dataset.date,
          period: dataset.period ?? dataset.date,
          count: typeof row.count === "number" ? row.count : null,
          volume: detail?.volume ?? null,
          applicable,
          affectsPriority: hasPersonalPlan,
          passed,
          persistent: passed === false && previousPassed === false,
          adverseChange:
            row.previous !== null &&
            (reverse ? row.fact > row.previous : row.fact < row.previous),
          score,
          status: hasPersonalPlan ? (passed ? "good" : "bad") : "reference",
        });
      }),
    );
    byOrg.forEach((owner) => {
      const present = new Set(owner.metrics.map((metric) => metric.id));
      Object.keys(moData).forEach((id) => {
          const dataset = moData[id];
          if (!dataset || present.has(id)) return;
          const applicable = applicableForRegistry(owner.registry, id);
          const priorityDataExpected =
            applicable &&
            indicatorRegistry.affectsHearingPriority(id) &&
            !blockedIndicatorIds.has(id) &&
            dataset.plan !== null;
          owner.metrics.push({
            id,
            name: dataset.name,
            fact: null,
            previous: null,
            plan: priorityDataExpected ? dataset.plan : null,
            unit: dataset.unit,
            date: dataset.date,
            period: dataset.period ?? dataset.date,
            count: null,
            volume: null,
            applicable,
            affectsPriority: priorityDataExpected,
            passed: null,
            persistent: false,
            adverseChange: false,
            score: null,
            detail: applicable
              ? "Нет строки в актуальной выгрузке"
              : "Показатель неприменим к профилю МО",
            status: applicable ? "missing" : "reference",
          });
        });

      const registrationErrors = registrationErrorsByOid.get(
        owner.registry.oid,
      );
      if (registrationErrors) {
        owner.metrics.push({
          id: "remd-registration-errors",
          name: "Отказы регистрации СЭМД",
          fact: registrationErrors.count,
          previous: null,
          plan: null,
          unit: " ошибок",
          date: errorCategories.period.split("–").at(-1) ?? errorCategories.period,
          period: errorCategories.period,
          count: null,
          volume: null,
          applicable: true,
          affectsPriority: false,
          passed: null,
          persistent: false,
          adverseChange: false,
          score: null,
          detail: registrationErrors.topCategories
            .map(
              (category) =>
                `${category.name} — ${format(category.count, 0)}`,
            )
            .join("; "),
          status: "reference",
        });
      }
    });
    const regionalDenominators = new Map<string, number>();
    byOrg.forEach(({ metrics }) =>
      metrics.forEach((metric) => {
        if (
          metric.affectsPriority &&
          metric.unit === "%" &&
          metric.volume !== null &&
          metric.volume > 0 &&
          metric.count !== null &&
          metric.plan !== null &&
          metric.plan >= 0 &&
          metric.id !== "tvspLaboratory"
        ) {
          regionalDenominators.set(
            metric.id,
            (regionalDenominators.get(metric.id) ?? 0) + metric.volume,
          );
        }
      }),
    );
    const prepared = [...byOrg.values()].map(({ registry, metrics: sourceMetrics }) => {
      const metrics = sourceMetrics.map((metric) => {
        const regionalDenominator = regionalDenominators.get(metric.id) ?? null;
        if (
          regionalDenominator === null ||
          metric.volume === null ||
          metric.count === null ||
          metric.plan === null
        )
          return { ...metric, regionalContribution: null };
        const targetCount = (metric.plan / 100) * metric.volume;
        const deficitCount = Math.max(0, targetCount - metric.count);
        return {
          ...metric,
          targetCount,
          deficitCount,
          regionalDenominator,
          regionalContribution: (deficitCount / regionalDenominator) * 100,
        };
      });
      const affecting = metrics.filter(
        (metric) => metric.regionalContribution !== null && metric.regionalContribution !== undefined,
      );
      const failed = affecting.filter((metric) => metric.passed === false);
      const missing = metrics.filter(
        (metric) => metric.affectsPriority && metric.status === "missing",
      );
      const persistentCount = failed.filter(
        (metric) => metric.persistent,
      ).length;
      const quantityGap = affecting.reduce(
        (sum, metric) => sum + (metric.deficitCount ?? 0),
        0,
      );
      const regionalContribution = affecting.reduce(
        (sum, metric) => sum + (metric.regionalContribution ?? 0),
        0,
      );
      const deficits = failed.map((metric) => 100 - (metric.score ?? 0));
      const severity = deficits.length
        ? Math.max(...deficits) * 0.6 +
          (deficits.reduce((sum, value) => sum + value, 0) / deficits.length) *
            0.4
        : 0;
      return {
        registry,
        metrics,
        affecting,
        failed,
        missing,
        persistentCount,
        quantityGap,
        regionalContribution,
        severity,
      };
    });
    const maxLog = Math.max(
      1,
      ...prepared.map((item) => Math.log1p(item.quantityGap)),
    );
    return prepared
      .map(
        ({
          registry,
          metrics,
          affecting,
          failed,
          missing,
          persistentCount,
          quantityGap,
          regionalContribution,
          severity,
        }) => {
          const failedCount = failed.length;
          const persistence = failedCount
            ? (persistentCount / failedCount) * 100
            : 0;
          const breadth = (failedCount / Math.max(1, affecting.length)) * 100;
          const scale = (Math.log1p(quantityGap) / maxLog) * 100;
          const adverse = failed.filter(
            (metric) => metric.adverseChange,
          ).length;
          const decline = failedCount ? (adverse / failedCount) * 100 : 0;
          const priority = regionalContribution;
          const level: HearingRow["level"] =
            priority >= 55 ||
            failedCount >= 3 ||
            persistentCount >= 2 ||
            missing.length >= 2
              ? "mandatory"
              : "control";
          const order = { bad: 0, missing: 1, good: 2, reference: 3 };
          const ordered = [...metrics].sort(
            (a, b) =>
              order[a.status] - order[b.status] ||
              (a.score ?? 101) - (b.score ?? 101) ||
              a.name.localeCompare(b.name, "ru"),
          );
          return {
            key: registry.oid,
            name: registry.shortName,
            type: registry.type,
            priority,
            severity,
            persistence,
            breadth,
            scale,
            decline,
            failedCount,
            persistentCount,
            missingCount: missing.length,
            dataCount: metrics.filter((metric) => metric.fact !== null).length,
            total: affecting.length,
            coverage:
              ((affecting.length - missing.length) /
                Math.max(1, affecting.length)) *
              100,
            quantityGap,
            regionalContribution,
            mainProblem:
              [...affecting].sort(
                (a, b) => (b.regionalContribution ?? 0) - (a.regionalContribution ?? 0),
              )[0] ??
              null,
            level,
            heard: heardOrganizationOids.has(registry.oid),
            metrics: ordered,
          };
        },
      )
      .filter((row) => row.failedCount > 0 || row.heard)
      .sort(
        (a, b) =>
          b.regionalContribution - a.regionalContribution ||
          b.failedCount - a.failedCount ||
          a.name.localeCompare(b.name, "ru"),
      );
  }, []);
  const hearingImpactSummary = useMemo(() => {
    const ranked = hearingRows.filter((row) => row.regionalContribution > 0);
    const total = ranked.reduce((sum, row) => sum + row.regionalContribution, 0);
    const topTen = ranked.slice(0, 10);
    const topTenContribution = topTen.reduce(
      (sum, row) => sum + row.regionalContribution,
      0,
    );
    const severeLowImpact = hearingRows.filter(
      (row) => row.failedCount >= 3 && row.regionalContribution < 0.1,
    );
    return {
      total,
      topTen,
      topTenContribution,
      topTenShare: total > 0 ? (topTenContribution / total) * 100 : 0,
      severeLowImpact,
    };
  }, [hearingRows]);
  const hearingTypes = useMemo(
    () => [
      "Все типы МО",
      ...Array.from(new Set(hearingRows.map((row) => row.type))).sort((a, b) =>
        a.localeCompare(b, "ru"),
      ),
    ],
    [hearingRows],
  );
  const visibleHearingRows = useMemo(
    () =>
      hearingRows.filter((row) => {
        const matchesLevel =
          hearingLevel === "all" ||
          (hearingLevel === "heard"
            ? row.heard
            : !row.heard && row.level === hearingLevel);
        return (
          matchesLevel &&
          (hearingType === "Все типы МО" || row.type === hearingType) &&
          cleanMoName(row.name)
            .toLocaleLowerCase("ru")
            .includes(hearingQuery.toLocaleLowerCase("ru"))
        );
      }),
    [hearingRows, hearingLevel, hearingType, hearingQuery],
  );
  const unionRatingRows = useMemo(
    () => buildUnionRating(ratingRows),
    [ratingRows],
  );
  const ratingTypes = useMemo(
    () =>
      Array.from(new Set(ratingRows.map((r) => r.type))).sort((a, b) =>
        a.localeCompare(b, "ru"),
      ),
    [ratingRows],
  );
  const [ratingView, setRatingView] = useState<"types" | "unions">("types");
  const [ratingType, setRatingType] = useState("Центральные районные больницы");
  const [ratingQuery, setRatingQuery] = useState("");
  const [ratingSortKey, setRatingSortKey] = useState<RatingSortKey>("place");
  const [ratingSortDirection, setRatingSortDirection] =
    useState<SortDirection>("asc");
  const [waybillQuery, setWaybillQuery] = useState("");
  const [waybillStatus, setWaybillStatus] = useState("all");
  const [waybillMode, setWaybillMode] = useState<"week" | "month">("week");
  const [waybillSortKey, setWaybillSortKey] =
    useState<WaybillSortKey>("movementShare");
  const [waybillSortDirection, setWaybillSortDirection] =
    useState<SortDirection>("desc");
  const federalRows = useMemo(
    () =>
      federalControl[federalSet].filter((row) => {
        const displayStatus =
          row.status === "Нет расчёта" ? "В контракте" : row.status;
        const statusMatches =
          federalStatus === "all" ||
          (federalStatus === "except-contract"
            ? displayStatus !== "В контракте"
            : displayStatus === federalStatus);
        return (
          statusMatches &&
          (row.id + " " + row.name + " " + row.type)
            .toLowerCase()
            .includes(federalQuery.toLowerCase())
        );
      }),
    [federalSet, federalStatus, federalQuery],
  );
  const unifiedCatalog = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];
    const byRegional = new Map<string, UnifiedRow>();
    (["agreement", "collegium"] as const).forEach((set) =>
      federalControl[set].forEach((row) => {
        if (row.regionalId) {
          if (!byRegional.has(row.regionalId)) {
            const item = {
              key: `regional-${row.regionalId}`,
              name: row.name,
              scope: "РФ и РТ" as const,
              federal: row,
              regionalId: row.regionalId,
            };
            byRegional.set(row.regionalId, item);
            rows.push(item);
          }
        } else
          rows.push({
            key: `rf-${set}-${row.id}`,
            name: row.name,
            scope: "РФ",
            federal: row,
          });
      }),
    );
    const controlled = new Set(byRegional.keys());
    liveIndicators
      .filter((item) => !controlled.has(item.id))
      .forEach((item) =>
        rows.push({
          key: `regional-${item.id}`,
          name: item.name,
          scope: "РТ",
          regionalId: item.id,
        }),
      );
    return rows;
  }, []);
  const unifiedRows = useMemo(
    () =>
      unifiedCatalog.filter((row) => {
        const scopeMatch =
          unifiedScope === "all" ||
          (unifiedScope === "rf" && row.scope !== "РТ") ||
          (unifiedScope === "rt" && row.scope !== "РФ") ||
          (unifiedScope === "both" && row.scope === "РФ и РТ");
        return (
          scopeMatch &&
          (row.name + " " + row.scope)
            .toLowerCase()
            .includes(unifiedQuery.toLowerCase())
        );
      }),
    [unifiedCatalog, unifiedScope, unifiedQuery],
  );
  const selectedUnified =
    unifiedCatalog.find((row) => row.key === unifiedSelected) ??
    unifiedCatalog[0];
  const selectedUnifiedIndicator = selectedUnified?.regionalId
    ? calculatedIndicatorById[selectedUnified.regionalId]
    : undefined;
  const selectedUnifiedDataset = selectedUnified?.regionalId
    ? moData[selectedUnified.regionalId]
    : undefined;
  const extendedCatalog = useMemo<ExtendedCardItem[]>(() => {
    const collegiumByKey = new Map(
      federalControl.collegium.map((row) => [strictIndicatorKey(row), row]),
    );
    const used = new Set<string>();
    const agreement = federalControl.agreement.map((row) => {
      const key = strictIndicatorKey(row),
        collegium = collegiumByKey.get(key);
      if (collegium) used.add(key);
      return {
        key: `agreement-${row.id}`,
        row,
        source: "agreement" as const,
        collegium,
      };
    });
    const collegium = federalControl.collegium
      .filter((row) => !used.has(strictIndicatorKey(row)))
      .map((row) => ({
        key: `collegium-${row.id}`,
        row,
        source: "collegium" as const,
      }));
    return [...agreement, ...collegium];
  }, []);
  const extendedRows = useMemo(
    () =>
      extendedCatalog.filter((item) => {
        const { row } = item;
        const category = federalCategory(row),
          status = regionalControlStatus(row, item.collegium);
        return (
          (extendedCategory === "all" || category === extendedCategory) &&
          (extendedStatusFilter === "all" ||
            (extendedStatusFilter === "exceptContract"
              ? status !== "contract"
              : status === extendedStatusFilter)) &&
          (row.id + " " + row.name + " " + (item.collegium?.id ?? ""))
            .toLowerCase()
            .includes(unifiedQuery.toLowerCase())
        );
      }),
    [extendedCatalog, extendedCategory, extendedStatusFilter, unifiedQuery],
  );
  const extendedAgreementRows = extendedRows.filter(
    (item) => item.source === "agreement",
  );
  const extendedCollegiumRows = extendedRows.filter(
    (item) => item.source === "collegium",
  );
  const extendedStats = useMemo(
    () =>
      extendedCatalog.reduce(
        (acc, item) => {
          acc[regionalControlStatus(item.row, item.collegium)]++;
          return acc;
        },
        { achieved: 0, notAchieved: 0, contract: 0, noData: 0 },
      ),
    [extendedCatalog],
  );
  const extendedFederalAchieved = {
    agreement: federalControl.agreement.filter(
      (row) => row.status === "Достигнут",
    ).length,
    collegium: federalControl.collegium.filter(
      (row) => row.status === "Достигнут",
    ).length,
  };
  const openExtendedMetric = (item: ExtendedCardItem) => {
    if (!item.row.regionalId) return;
    setExtendedReturn({ point: item.row.id, scrollY: window.scrollY });
    setMatrixMetric(item.row.regionalId);
    setDynamicsMode("week");
    setTab("matrix");
    setShowMatrixSections(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const returnToExtended = () => {
    const saved = extendedReturn;
    setTab("unified");
    setShowMatrixSections(false);
    setTimeout(
      () => window.scrollTo({ top: saved?.scrollY ?? 0, behavior: "auto" }),
      0,
    );
    setExtendedReturn(null);
  };
  const federalSummaryStats = useMemo(() => {
    let federalAchieved = 0,
      regionalAchieved = 0,
      regionalNotAchieved = 0,
      contract = 0,
      noData = 0,
      improved = 0,
      worsened = 0;
    federalControl[federalSet].forEach((row) => {
      if (row.status === "Достигнут") federalAchieved += 1;
      const regionalStatus = regionalControlStatus(row);
      if (regionalStatus === "achieved") regionalAchieved += 1;
      else if (regionalStatus === "notAchieved") regionalNotAchieved += 1;
      else if (regionalStatus === "contract") contract += 1;
      else noData += 1;
      const regional = row.regionalId
        ? calculatedIndicatorById[row.regionalId]
        : undefined;
      if (regional) {
        if (regional.trend !== null && regional.trend !== 0) {
          const isImprovement = regional.reverse
            ? regional.trend < 0
            : regional.trend > 0;
          if (isImprovement) improved += 1;
          else worsened += 1;
        }
      }
    });
    return {
      total: federalControl[federalSet].length,
      federalAchieved,
      regionalAchieved,
      regionalNotAchieved,
      contract,
      noData,
      improved,
      worsened,
    };
  }, [federalSet]);
  const currentRating = useMemo(
    () =>
      ratingRows
        .filter((r) => r.type === ratingType)
        .sort(
          (a, b) =>
            (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
            b.coverage - a.coverage ||
            a.name.localeCompare(b.name, "ru"),
        ),
    [ratingRows, ratingType],
  );
  const rankedCurrent = useMemo(
    () => currentRating.filter((r) => r.score !== null),
    [currentRating],
  );
  const visibleRating = useMemo(() => {
    const place = new Map(
      rankedCurrent.map((row, index) => [row.key, index + 1]),
    );
    const value = (row: RankRow) => {
      if (ratingSortKey === "place") return place.get(row.key) ?? Infinity;
      if (ratingSortKey === "name")
        return cleanMoName(row.name).toLocaleLowerCase("ru");
      if (ratingSortKey === "score") return row.score ?? -Infinity;
      if (
        ratingSortKey === "care" ||
        ratingSortKey === "services" ||
        ratingSortKey === "readiness"
      )
        return row.blocks[ratingSortKey] ?? -Infinity;
      if (ratingSortKey === "passed")
        return row.passed / Math.max(1, row.total);
      if (ratingSortKey === "change") return row.change ?? -Infinity;
      if (ratingSortKey === "coverage") return row.coverage;
      return row.score === null
        ? -1
        : row.score >= 95
          ? 2
          : row.score >= 80
            ? 1
            : 0;
    };
    return currentRating
      .filter((r) => r.name.toLowerCase().includes(ratingQuery.toLowerCase()))
      .sort((a, b) => {
        const av = value(a),
          bv = value(b);
        const compared =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv, "ru")
            : Number(av) - Number(bv);
        return (
          (ratingSortDirection === "asc" ? compared : -compared) ||
          a.name.localeCompare(b.name, "ru")
        );
      });
  }, [
    currentRating,
    rankedCurrent,
    ratingQuery,
    ratingSortKey,
    ratingSortDirection,
  ]);
  const setRatingSort = (key: RatingSortKey) => {
    if (ratingSortKey === key)
      setRatingSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setRatingSortKey(key);
      setRatingSortDirection(
        key === "place" || key === "name" ? "asc" : "desc",
      );
    }
  };
  const waybillRows =
    waybillMode === "week"
      ? electronicWaybillWeekly.current.rows
      : electronicWaybill.rows;
  const previousWaybillByNumber = useMemo(
    () =>
      new Map(
        electronicWaybillWeekly.previous.rows.map((row) => [
          row.sourceNumber,
          row,
        ]),
      ),
    [],
  );
  const waybillZone = (row: WaybillRow) =>
    row.vehicles === 0
      ? "noFleet"
      : row.moved === 0
        ? "noMovement"
        : (row.movementShare ?? 0) >= 80
          ? "stable"
          : (row.movementShare ?? 0) >= 30
            ? "partial"
            : "low";
  const waybillComparable = useMemo(
    () => waybillRows.filter((row) => row.vehicles > 0),
    [waybillRows],
  );
  const waybillLeaders = useMemo(
    () =>
      [...waybillComparable]
        .sort(
          (a, b) =>
            b.moved - a.moved ||
            (b.movementShare ?? -1) - (a.movementShare ?? -1) ||
            b.vehicles - a.vehicles ||
            cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru"),
        )
        .slice(0, 10),
    [waybillComparable],
  );
  const waybillAttention = useMemo(
    () =>
      [...waybillComparable]
        .sort((a, b) => {
          if (waybillMode === "week") {
            const ap =
                a.moved === 0 &&
                previousWaybillByNumber.get(a.sourceNumber)?.moved === 0
                  ? 1
                  : 0,
              bp =
                b.moved === 0 &&
                previousWaybillByNumber.get(b.sourceNumber)?.moved === 0
                  ? 1
                  : 0;
            if (ap !== bp) return bp - ap;
          }
          return (
            b.vehicles - b.moved - (a.vehicles - a.moved) ||
            (a.movementShare ?? Infinity) - (b.movementShare ?? Infinity) ||
            b.vehicles - a.vehicles ||
            cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru")
          );
        })
        .slice(0, 10),
    [waybillComparable, waybillMode, previousWaybillByNumber],
  );
  const waybillZones = useMemo(
    () => ({
      stable: waybillRows.filter((r) => waybillZone(r) === "stable").length,
      partial: waybillRows.filter((r) => waybillZone(r) === "partial").length,
      low: waybillRows.filter((r) => waybillZone(r) === "low").length,
      noMovement: waybillRows.filter((r) => waybillZone(r) === "noMovement")
        .length,
      noFleet: waybillRows.filter((r) => waybillZone(r) === "noFleet").length,
    }),
    [waybillRows],
  );
  const waybillSignals = useMemo(
    () => [
      {
        label: "Путевые листы есть, движения нет",
        rows: waybillRows.filter((r) => r.waybills > 0 && r.moved === 0),
      },
      {
        label: "Автопарк есть, активных водителей нет",
        rows: waybillRows.filter(
          (r) => r.vehicles > 0 && r.driversWithWaybills === 0,
        ),
      },
      {
        label: "Активных водителей больше зарегистрированных",
        rows: waybillRows.filter((r) => r.driversWithWaybills > r.drivers),
      },
      {
        label: "Движение прекратилось за неделю",
        rows:
          waybillMode === "week"
            ? waybillRows.filter(
                (r) =>
                  r.vehicles > 0 &&
                  r.moved === 0 &&
                  (previousWaybillByNumber.get(r.sourceNumber)?.moved ?? 0) > 0,
              )
            : [],
      },
    ],
    [waybillRows, waybillMode, previousWaybillByNumber],
  );
  const visibleWaybillRows = useMemo(() => {
    const value = (row: WaybillRow) => {
      if (waybillSortKey === "name")
        return cleanMoName(row.name).toLocaleLowerCase("ru");
      if (waybillSortKey === "status")
        return (
          { stable: 4, partial: 3, low: 2, noMovement: 1, noFleet: 0 }[
            waybillZone(row)
          ] ?? 0
        );
      if (waybillSortKey === "weekDelta") {
        const previous = previousWaybillByNumber.get(row.sourceNumber);
        return previous &&
          previous.movementShare !== null &&
          row.movementShare !== null
          ? row.movementShare - previous.movementShare
          : -Infinity;
      }
      return row[waybillSortKey] ?? -Infinity;
    };
    return waybillRows
      .filter(
        (row) =>
          cleanMoName(row.name)
            .toLocaleLowerCase("ru")
            .includes(waybillQuery.toLocaleLowerCase("ru")) &&
          (waybillStatus === "all" || waybillZone(row) === waybillStatus),
      )
      .sort((a, b) => {
        const av = value(a),
          bv = value(b);
        const compared =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv, "ru")
            : Number(av) - Number(bv);
        return (
          (waybillSortDirection === "asc" ? compared : -compared) ||
          cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru")
        );
      });
  }, [
    waybillRows,
    waybillQuery,
    waybillStatus,
    waybillSortKey,
    waybillSortDirection,
    previousWaybillByNumber,
  ]);
  const setWaybillSort = (key: WaybillSortKey) => {
    if (waybillSortKey === key)
      setWaybillSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setWaybillSortKey(key);
      setWaybillSortDirection(key === "name" ? "asc" : "desc");
    }
  };
  const groups = [
    "Все направления",
    ...Array.from(new Set(liveIndicators.map((i) => i.group))),
  ];
  const filtered = liveIndicators.filter(
    (i) => group === "Все направления" || i.group === group,
  );
  const planned = liveIndicators.filter((i) => i.plan !== null);
  const achieved = planned.filter(
    (i) => statusFor(i.fact, i.plan, Boolean(i.reverse)) === "good",
  ).length;
  const selectedDataset = moData[matrixMetric];
  const preventiveTransition = matrixMetric === "semd228";
  const selectedGuidance = guidance[matrixMetric];
  const selectedMethodology = methodologies.find(
    (methodology) => methodology.id === matrixMetric,
  );
  const isCountMetric = selectedDataset.mode === "count";
  const isPresenceMetric = selectedDataset.mode === "presence";
  const isMaxMetric =
    matrixMetric === "tmkMaxCount" || matrixMetric === "elnMaxCount";
  const maxMetricTotals = {
    tmk: calculatedIndicatorById.tmkMaxCount?.fact ?? 0,
    eln: calculatedIndicatorById.elnMaxCount?.fact ?? 0,
  };
  const selectedUnitDataset = unitData[matrixMetric];
  const lowerIsBetter =
    matrixMetric === "shortInput" || selectedDataset.direction === "lower";
  const periods = comparisonPeriods[matrixMetric] ?? {
    previous: "предыдущий период",
    current: `на ${selectedDataset.date}`,
  };
  const previousSnapshot = snapshotDate(periods.previous);
  const currentSnapshot = snapshotDate(periods.current);
  const indicatorRows = selectedDataset.rows.filter(
    (o) =>
      !isTechnicalRow(o.name) &&
      !isExcludedFromIndicators(o.name) &&
      (!indicatorRegistry.hasRowExclusion(matrixMetric, "max_profile_inapplicable") ||
        !isMaxProfileInapplicable(o.name)),
  );
  const visibleOrgs = useMemo(() => {
    const rows = indicatorRows
      .filter((o) => moOwnership === "all" || !isPrivateOrganization(o.name))
      .filter((o) =>
        moSearchText(matrixMetric, o).includes(query.toLocaleLowerCase("ru")),
      )
      .filter(
        (o) =>
          isCountMetric ||
          moStatus === "all" ||
          (!isUnavailableSourceRow(o) &&
            (isPresenceMetric
              ? moStatus === "achieved"
                ? o.fact > 0
                : o.fact === 0
              : moStatus === "achieved"
                ? o.fact >= (selectedDataset.plan ?? 0)
                : o.fact < (selectedDataset.plan ?? 0))),
      );
    const value = (row: MoRow) => {
      const detail = getMoDetail(matrixMetric, row);
      if (moSortKey === "name")
        return cleanMoName(row.name).toLocaleLowerCase("ru");
      if (moSortKey === "quantity")
        return row.count ?? detail?.registered ?? -1;
      if (moSortKey === "previous") return row.previous ?? -Infinity;
      if (moSortKey === "trend") return row.trend ?? -Infinity;
      if (moSortKey === "status")
        return isCountMetric || isPresenceMetric
          ? Number(row.fact > 0)
          : row.fact >= (selectedDataset.plan ?? 0)
            ? 2
            : row.fact >= (selectedDataset.plan ?? 0) * 0.9
              ? 1
              : 0;
      if (moSortKey === "deviation")
        return row.fact - (selectedDataset.plan ?? 0);
      return row.fact;
    };
    return [...rows].sort((a, b) => {
      const av = value(a),
        bv = value(b);
      const compared =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "ru")
          : Number(av) - Number(bv);
      return (
        (moSortDirection === "asc" ? compared : -compared) ||
        cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru")
      );
    });
  }, [
    query,
    indicatorRows,
    selectedDataset.plan,
    moOwnership,
    moStatus,
    moSortKey,
    moSortDirection,
    isCountMetric,
    isPresenceMetric,
    matrixMetric,
  ]);
  const visibleUnits = useMemo(() => {
    if (!selectedUnitDataset) return [];
    const rows = selectedUnitDataset.rows
      .filter((row) => !isExcludedFromIndicators(row.mo))
      .filter((row) =>
        (row.mo + " " + row.unit + " " + row.unitOid)
          .toLowerCase()
          .includes(unitQuery.toLowerCase()),
      )
      .filter(
        (row) =>
          unitStatus === "all" ||
          (unitStatus === "yes" ? row.registered : !row.registered),
      );
    const value = (row: UnitRow) =>
      unitSortKey === "mo"
        ? cleanMoName(row.mo).toLowerCase()
        : unitSortKey === "unit"
          ? row.unit.toLowerCase()
          : unitSortKey === "count"
            ? row.count
            : Number(row.registered);
    return [...rows].sort((a, b) => {
      const av = value(a),
        bv = value(b);
      const c =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "ru")
          : Number(av) - Number(bv);
      return (
        (unitSortDirection === "asc" ? c : -c) ||
        cleanMoName(a.mo).localeCompare(cleanMoName(b.mo), "ru")
      );
    });
  }, [
    selectedUnitDataset,
    unitQuery,
    unitStatus,
    unitSortKey,
    unitSortDirection,
  ]);
  const evaluableIndicatorRows = indicatorRows.filter(
    (row) => !isUnavailableSourceRow(row),
  );
  const achievedMos = isPresenceMetric
    ? evaluableIndicatorRows.filter((r) => r.fact > 0).length
    : selectedDataset.plan === null
      ? 0
      : evaluableIndicatorRows.filter((r) => r.fact >= selectedDataset.plan!)
          .length;
  const improvedMos = indicatorRows.filter(
    (r) => r.trend !== null && (lowerIsBetter ? r.trend < 0 : r.trend > 0),
  ).length;
  const worsenedMos = indicatorRows.filter(
    (r) => r.trend !== null && (lowerIsBetter ? r.trend > 0 : r.trend < 0),
  ).length;
  const rtIndicator = calculatedIndicatorById[matrixMetric];
  const detailRows = Object.values(moDetails[matrixMetric] ?? {});
  const detailAggregate = aggregateComponents(detailRows);
  const regionalFact = isCountMetric
    ? (rtIndicator?.fact ?? aggregateCountRows(indicatorRows))
    : (rtIndicator?.fact ?? (detailRows.length ? detailAggregate.fact : 0));
  const operationalRegionalPrevious: Record<string, number> = {
    egpu: (29814 / 30260) * 100,
    egpu2days: (24533 / 30260) * 100,
  };
  const regionalPrevious = operationalRegionalPrevious[matrixMetric] ?? (isCountMetric
    ? indicatorRows.reduce((sum, row) => sum + (row.previous ?? 0), 0)
    : rtIndicator?.trend === null || rtIndicator?.trend === undefined
      ? null
      : regionalFact - rtIndicator.trend);
  const regionalChange =
    regionalPrevious === null ? null : regionalFact - regionalPrevious;
  type MonthlyBenchmark = {
    june: number;
    july: number;
    unit: "%" | "count";
    juneQuantity?: string;
    julyQuantity?: string;
    source: string;
  };
  const monthlyBenchmarks: Record<string, MonthlyBenchmark> = {
    egpu: {
      june: 96.9075,
      july: 95.6268,
      unit: "%",
      juneQuantity: "3 071 из 3 169",
      julyQuantity: "3 936 из 4 116",
      source: "Заявления о прикреплении через ЕПГУ",
    },
    egpu2days: {
      june: 67.5607,
      july: 67.0311,
      unit: "%",
      juneQuantity: "2 141 из 3 169",
      julyQuantity: "2 759 из 4 116",
      source: "Заявления, рассмотренные за 2 суток",
    },
    birth: {
      june: 99.8906,
      july: 98.7193,
      unit: "%",
      juneQuantity: "2 738 из 2 741",
      julyQuantity: "2 852 из 2 889",
      source: "Медицинские свидетельства о рождении",
    },
    death: {
      june: 95.7315,
      july: 92.8051,
      unit: "%",
      juneQuantity: "2 938 из 3 069",
      julyQuantity: "3 186 из 3 433",
      source: "Медицинские свидетельства о смерти",
    },
    semd228: {
      june: 42.8342,
      july: 47.03,
      unit: "%",
      juneQuantity: "63 443 из 148 113",
      julyQuantity: "55 715 из 118 467",
      source: "СЭМД №228",
    },
    hospital: {
      june: 65.0319,
      july: 89.9899,
      unit: "%",
      juneQuantity: "54 539 из 83 865",
      julyQuantity: "76 073 из 84 535",
      source: "Выписные эпикризы",
    },
    ambulatoryCase: {
      june: 79.9821,
      july: 75.7095,
      unit: "%",
      juneQuantity: "941 206 из 1 176 771",
      julyQuantity: "790 929 из 1 044 689",
      source: "Амбулаторные эпикризы",
    },
    tmkMaxCount: {
      june: 6125,
      july: 6689,
      unit: "count",
      source: "ТМК посредством МАХ",
    },
    elnMaxCount: {
      june: 5952,
      july: 6153,
      unit: "count",
      source: "Закрытие ЛВН после ТМК посредством МАХ",
    },
  };
  const adultPreventiveMonthlyRows = monthlyMoData.semd228?.rows ?? [];
  const aggregatePreventiveMonth = (field: "juneQuantity" | "julyQuantity") => {
    const totals = aggregateQuantityPairs(adultPreventiveMonthlyRows, field);
    return {
      fact: totals.fact,
      label: `${format(totals.numerator, 0)} из ${format(totals.denominator, 0)}`,
    };
  };
  const adultJune = aggregatePreventiveMonth("juneQuantity"),
    adultJuly = aggregatePreventiveMonth("julyQuantity");
  const monthBenchmark =
    matrixMetric === "semd228"
      ? {
          june: adultJune.fact,
          july: adultJuly.fact,
          unit: "%" as const,
          juneQuantity: adultJune.label,
          julyQuantity: adultJuly.label,
          source: "MAX СЭМД №122/228 · взрослые и детские МО",
        }
      : monthlyBenchmarks[matrixMetric];
  const monthlyDataset =
    matrixMetric === "semd228"
      ? { ...monthlyMoData.semd228, rows: adultPreventiveMonthlyRows }
      : monthlyMoData[matrixMetric];
  const metricDisplayName = (id: string) =>
    id === "tmkMaxCount" ? "ТМК и ЛВН посредством МАХ" : moData[id].name;
  const filteredMetricIds = metricIds.filter((id) =>
    metricDisplayName(id)
      .toLowerCase()
      .includes(metricQuery.trim().toLowerCase()),
  );
  const sidebarMetricValue = (id: string) => {
    if (id === "tmkMaxCount")
      return `${format(calculatedIndicatorById.tmkMaxCount?.fact ?? 0, 0)} / ${format(calculatedIndicatorById.elnMaxCount?.fact ?? 0, 0)}`;
    const dataset = moData[id];
    if (dataset.mode === "count")
      return `${format(calculatedIndicatorById[id]?.fact ?? 0, 0)}`;
    const indicator = calculatedIndicatorById[id];
    const details = Object.values(moDetails[id] ?? {});
    const fact = indicator?.fact ?? (details.length ? aggregateComponents(details).fact : 0);
    return `${format(fact, 2)}%`;
  };
  const sidebarMetricTone = (id: string) => {
    if (id === "tmkMaxCount") return "neutral";
    const dataset = moData[id];
    if (dataset.mode === "count" || dataset.plan === null) return "neutral";
    const indicator = calculatedIndicatorById[id];
    const details = Object.values(moDetails[id] ?? {});
    const fact = indicator?.fact ?? (details.length ? aggregateComponents(details).fact : 0);
    const ok =
      dataset.direction === "lower"
        ? fact <= dataset.plan
        : fact >= dataset.plan;
    if (ok) return "good";
    const near =
      dataset.direction === "lower"
        ? fact <= dataset.plan * 1.1
        : fact >= dataset.plan * 0.9;
    return near ? "warn" : "bad";
  };
  const quantityFor = (row: MoRow) =>
    row.count ?? getMoDetail(matrixMetric, row)?.registered ?? 0;
  const managementRows = indicatorRows.filter(
    (r) => !isPrivateOrganization(r.name),
  );
  const evaluableManagementRows = managementRows.filter(
    (row) => !isUnavailableSourceRow(row),
  );
  const managementRowsWithComponents = managementRows.map((row) => {
    const detail = getMoDetail(matrixMetric, row);
    return {
      ...row,
      count: detail?.registered ?? row.count ?? null,
      volume: detail?.volume ?? null,
    };
  });
  const componentRanking =
    !isCountMetric &&
    !isPresenceMetric &&
    selectedDataset.plan !== null &&
    managementRowsWithComponents.some(
      (row) => row.count !== null && row.volume !== null,
    );
  const leaders = [
    ...(componentRanking
      ? managementRowsWithComponents.filter(
          (row) => !isUnavailableSourceRow(row),
        )
      : evaluableManagementRows),
  ]
    .sort((a, b) => {
      if (componentRanking) {
        const plan = selectedDataset.plan ?? 0;
        const aMet = a.fact >= plan;
        const bMet = b.fact >= plan;
        if (aMet !== bMet) return aMet ? -1 : 1;
        if (aMet && bMet)
          return (
            quantityFor(b) - quantityFor(a) ||
            b.fact - a.fact ||
            a.name.localeCompare(b.name, "ru")
          );
        return (
          b.fact - a.fact ||
          quantityFor(b) - quantityFor(a) ||
          a.name.localeCompare(b.name, "ru")
        );
      }
      const byFact = lowerIsBetter ? a.fact - b.fact : b.fact - a.fact;
      return (
        byFact ||
        quantityFor(b) - quantityFor(a) ||
        a.name.localeCompare(b.name, "ru")
      );
    })
    .slice(0, 10);
  const displayedLeaders = leaders;
  const attentionRows = evaluableManagementRows
    .filter((r) => !excludedFromAttention(r.name))
    .map((row) =>
      (matrixMetric === "birth" || matrixMetric === "death") &&
      row.attentionFact !== undefined
        ? {
            ...row,
            fact: row.attentionFact,
            count: row.overdueRegistered ?? row.count,
            volume: row.overdueVolume ?? row.volume,
          }
        : row,
    );
  const quantitativeAttention = componentRanking
    ? attentionRows
        .map((row) => {
          const detail = getMoDetail(matrixMetric, row);
          return {
            ...row,
            count: detail?.registered ?? row.count ?? null,
            volume: detail?.volume ?? null,
          };
        })
        .filter((row) => row.fact < (selectedDataset.plan ?? 0))
        .sort((a, b) => {
          const gap = (row: MoRow) =>
            row.volume === null || row.volume === undefined
              ? 0
              : Math.max(
                  0,
                  Math.ceil(((selectedDataset.plan ?? 0) / 100) * row.volume) -
                    Number(row.count ?? 0),
                );
          return (
            gap(b) - gap(a) ||
            a.fact - b.fact ||
            cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru")
          );
        })
        .slice(0, 10)
    : null;
  const laggards =
    quantitativeAttention ??
    (isCountMetric
      ? [...attentionRows]
          .sort((a, b) => (lowerIsBetter ? b.fact - a.fact : a.fact - b.fact))
          .slice(0, 10)
      : isPresenceMetric
        ? [...attentionRows]
            .filter((r) => r.fact === 0)
            .sort((a, b) =>
              cleanMoName(a.name).localeCompare(cleanMoName(b.name), "ru"),
            )
            .slice(0, 10)
        : [...attentionRows]
            .filter((r) => r.fact < (selectedDataset.plan ?? 0))
            .sort((a, b) => a.fact - b.fact)
            .slice(0, 10));
  const deterioration = [...attentionRows]
    .filter(
      (r) =>
        r.trend !== null &&
        (lowerIsBetter ? (r.trend ?? 0) > 0 : (r.trend ?? 0) < 0),
    )
    .sort((a, b) =>
      lowerIsBetter
        ? (b.trend ?? 0) - (a.trend ?? 0)
        : (a.trend ?? 0) - (b.trend ?? 0),
    )
    .slice(0, 10);
  const visibleSemd = semdSummary.items
    .filter((i) => !semdOnlyRegistered || i.count > 0)
    .filter((i) => i.name.toLowerCase().includes(semdQuery.toLowerCase()))
    .sort((a, b) => {
      const av =
        semdSortKey === "name"
          ? a.name
          : semdSortKey === "format"
            ? a.format
            : semdSortKey === "share"
              ? a.count / semdSummary.total
              : a.count;
      const bv =
        semdSortKey === "name"
          ? b.name
          : semdSortKey === "format"
            ? b.format
            : semdSortKey === "share"
              ? b.count / semdSummary.total
              : b.count;
      const compared =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "ru")
          : Number(av) - Number(bv);
      return semdSortDirection === "asc" ? compared : -compared;
    });

  const errorBreakdown = errorCategories.organizationBreakdown;
  const unassignedErrorOrganization: ErrorOrganization | null =
    errorBreakdown && errorBreakdown.unassignedErrors > 0
      ? {
          key: "__unassigned__",
          oid: null,
          name: "Медицинская организация не определена",
          count: errorBreakdown.unassignedErrors,
          topCategories: errorBreakdown.unassignedCategories.slice(0, 3),
          categories: errorBreakdown.unassignedCategories,
        }
      : null;
  const allErrorOrganizations = errorBreakdown
    ? [
        ...errorBreakdown.organizations,
        ...(unassignedErrorOrganization ? [unassignedErrorOrganization] : []),
      ]
    : [];
  const filteredErrorOrganizations = allErrorOrganizations.filter((item) =>
    `${item.name} ${item.oid ?? ""}`
      .toLowerCase()
      .includes(errorOrganizationQuery.trim().toLowerCase()),
  );
  const activeErrorOrganization =
    allErrorOrganizations.find((item) => item.key === selectedErrorOrganization) ?? null;
  const selectedCategoryOrganizations = selectedErrorCategory
    ? allErrorOrganizations
        .map((item) => ({
          key: item.key,
          oid: item.oid,
          name: item.name,
          count:
            item.categories.find((category) => category.name === selectedErrorCategory)
              ?.count ?? 0,
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    : [];

  const setMoSort = (key: MoSortKey) => {
    if (moSortKey === key)
      setMoSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setMoSortKey(key);
      setMoSortDirection(key === "name" ? "asc" : "desc");
    }
  };
  const setSemdSort = (key: "name" | "format" | "count" | "share") => {
    if (semdSortKey === key)
      setSemdSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSemdSortKey(key);
      setSemdSortDirection(key === "name" || key === "format" ? "asc" : "desc");
    }
  };
  const setUnitSort = (key: "mo" | "unit" | "count" | "status") => {
    if (unitSortKey === key)
      setUnitSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setUnitSortKey(key);
      setUnitSortDirection(
        key === "mo" || key === "unit" || key === "status" ? "asc" : "desc",
      );
    }
  };
  const sortMark = (active: boolean, direction: SortDirection) =>
    active ? (direction === "asc" ? "↑" : "↓") : "↕";
  const renderMaxValue = (item: MaxServiceValue) => {
    if (item.status === "missing") return <span className="maxMissing">Нет строки в выгрузке</span>;
    if (item.status === "unavailable") return <span className="maxUnavailable">Нет сопоставимого полного месяца</span>;
    return (
      <span className="maxValue">
        <b>{format(item.value ?? 0, 0)}</b>
        {item.share != null && <small>{format(item.share, 2)}% объёма РТ</small>}
      </span>
    );
  };

  return (
    <main>
      <header className="topbar">
        <button
          className="mobileMenuButton"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Открыть разделы"
        >
          ☰
        </button>
        <div className="brand">
          <span className="brandMark">РТ</span>
          <div>
            <strong>Цифровое здравоохранение</strong>
            <small>Республика Татарстан</small>
          </div>
        </div>
        <div className="asof">
          <span className="pulse" /> Версия {DASHBOARD_VERSION} · данные на
          30.08.2026
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className="mobileMenuBackdrop"
          onClick={() => setMobileMenuOpen(false)}
        >
          <nav className="mobileSections" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Разделы</strong>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </header>
            {[
              ["unified", "Расширенная сводка", "01"],
              ["matrix", "Показатели", "02"],
              ["ranking", "Рейтинг медицинских организаций", "03"],
              ["hearings", "МО для заслушивания", "04"],
              ["waybill", "Электронный путевой лист", "06"],
              ["remdErrors", "Ошибки РЭМД", "07"],
              ["divider", "В разработке", ""],
              ["federal", "Показатели на контроле РФ", "08"],
              ["methods", "Методики расчёта", "09"],
              ["history", "История обновлений", "10"],
              ["semd", "Все виды СЭМД", "11"],
              ["errors", "Ошибки методик", "12"],
              ["max", "МАХ", "05"],
            ].map(([id, label, number]) =>
              id === "divider" ? (
                <div className="mobileSectionDivider" key={id}>
                  {label}
                </div>
              ) : (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => {
                    setTab(id as typeof tab);
                    setShowMatrixSections(false);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span>{number}</span>
                  {label}
                </button>
              ),
            )}
          </nav>
        </div>
      )}

      <div className="shell">
        <aside
          className={`sidebar ${tab === "matrix" && !showMatrixSections ? "matrixWorkspace" : ""}`}
        >
          {tab === "matrix" && !showMatrixSections ? (
            <>
              <button
                className="backSections"
                onClick={() => setShowMatrixSections(true)}
              >
                ← Все разделы
              </button>
              <div className="sideMetrics">
                <div className="sideMetricsHead">
                  <span>ПОКАЗАТЕЛИ</span>
                  <b>{metricIds.length}</b>
                </div>
                <input
                  className="sideMetricSearch"
                  value={metricQuery}
                  onChange={(e) => setMetricQuery(e.target.value)}
                  placeholder="Найти показатель"
                  aria-label="Найти показатель"
                />
                <div className="sideMetricList">
                  {filteredMetricIds.map((id) => (
                    <button
                      key={id}
                      className={`sideMetricButton ${sidebarMetricTone(id)} ${matrixMetric === id || (id === "tmkMaxCount" && matrixMetric === "elnMaxCount") ? "active" : ""}`}
                      onClick={() => setMatrixMetric(id)}
                      title={metricDisplayName(id)}
                    >
                      <span>{metricDisplayName(id)}</span>
                      <b>{sidebarMetricValue(id)}</b>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="sideLabel">РАЗДЕЛЫ</p>
              <button
                className={tab === "unified" ? "active" : ""}
                onClick={() => {
                  setTab("unified");
                  setShowMatrixSections(false);
                }}
              >
                <span>01</span> Расширенная сводка
              </button>
              <button
                className={tab === "matrix" ? "active" : ""}
                onClick={() => {
                  setTab("matrix");
                  setShowMatrixSections(false);
                }}
              >
                <span>02</span> Показатели
              </button>
              <button
                className={tab === "ranking" ? "active" : ""}
                onClick={() => {
                  setTab("ranking");
                  setShowMatrixSections(false);
                }}
              >
                <span>03</span> Рейтинг медицинских организаций
              </button>
              <button
                className={tab === "hearings" ? "active" : ""}
                onClick={() => {
                  setTab("hearings");
                  setShowMatrixSections(false);
                }}
              >
                <span>04</span> МО для заслушивания{" "}
                <b>
                  {
                    hearingRows.filter((row) => row.level === "mandatory")
                      .length
                  }
                </b>
              </button>
              <button
                className={tab === "waybill" ? "active" : ""}
                onClick={() => {
                  setTab("waybill");
                  setShowMatrixSections(false);
                }}
              >
                <span>06</span> Электронный путевой лист
              </button>
              <button
                className={tab === "remdErrors" ? "active" : ""}
                onClick={() => {
                  setTab("remdErrors");
                  setShowMatrixSections(false);
                }}
              >
                <span>07</span> Ошибки РЭМД
              </button>
              <div className="sideDevelopment">
                <span>В разработке</span>
              </div>
              <button
                className={`developmentSection ${tab === "federal" ? "active" : ""}`}
                onClick={() => {
                  setTab("federal");
                  setShowMatrixSections(false);
                }}
              >
                <span>08</span> Показатели на контроле РФ
              </button>
              <button
                className={`developmentSection ${tab === "methods" ? "active" : ""}`}
                onClick={() => {
                  setTab("methods");
                  setShowMatrixSections(false);
                }}
              >
                <span>09</span> Методики расчёта
              </button>
              <button
                className={`developmentSection ${tab === "history" ? "active" : ""}`}
                onClick={() => {
                  setTab("history");
                  setShowMatrixSections(false);
                }}
              >
                <span>10</span> История обновлений
              </button>
              <button
                className={`developmentSection ${tab === "semd" ? "active" : ""}`}
                onClick={() => {
                  setTab("semd");
                  setShowMatrixSections(false);
                }}
              >
                <span>11</span> Все виды СЭМД
              </button>
              <button
                className={`developmentSection ${tab === "errors" ? "active" : ""}`}
                onClick={() => {
                  setTab("errors");
                  setShowMatrixSections(false);
                }}
              >
                <span>12</span> Ошибки методик <b>{calcErrors.length}</b>
              </button>
              <button
                className={`developmentSection ${tab === "max" ? "active" : ""}`}
                onClick={() => { setTab("max"); setShowMatrixSections(false); }}
              >
                <span>05</span> МАХ
              </button>
              <div className="sideFoot">
                <p>Версия {DASHBOARD_VERSION}</p>
                <small>
                  Показатели рассчитаны по представленным файлам.
                  Неподтверждённые планы отмечены серым.
                </small>
              </div>
            </>
          )}
        </aside>

        <section className="content">
          {tab === "summary" && (
            <>
              <div className="pageHead">
                <div>
                  <p className="eyebrow">РУКОВОДИТЕЛЬСКИЙ ОБЗОР</p>
                  <h1>Достижение планов по цифровизации</h1>
                  <p>
                    Последний доступный срез · плановый период указан в каждой
                    карточке
                  </p>
                </div>
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  {groups.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="heroStats">
                <article>
                  <small>Всего СЭМД зарегистрировано</small>
                  <strong>{format(currentSemdTotal.value, 0)}</strong>
                  <span>
                    {currentSemdTotal.types} видов · на {currentSemdTotal.date}
                  </span>
                </article>
                <article>
                  <small>Показателей с установленным планом</small>
                  <strong>{planned.length}</strong>
                  <span>годовые и месячные планы</span>
                </article>
                <article>
                  <small>План достигнут</small>
                  <strong className="green">{achieved}</strong>
                  <span>
                    {Math.round((achieved / planned.length) * 100)}% плановых
                    показателей
                  </span>
                </article>
                <article>
                  <small>Требуют внимания</small>
                  <strong className="red">{planned.length - achieved}</strong>
                  <span>отклонение от утверждённого плана</span>
                </article>
                <article>
                  <small>Качество расчётов</small>
                  <strong className="amber">{calcErrors.length}</strong>
                  <span>выявленных методических ошибок</span>
                </article>
              </div>
              <div className="sectionTitle operationalTitle">
                <div>
                  <p className="eyebrow">ОПЕРАТИВНЫЙ КОНТРОЛЬ</p>
                  <h2>Дополнительные объёмы и события</h2>
                </div>
                <span>не входят в итог достижения плана</span>
              </div>
              <div className="operationalGrid">
                {operational.map((o) => (
                  <article
                    key={o.title}
                    className={`operationalCard ${o.accent}`}
                  >
                    <div>
                      <h3>{o.title}</h3>
                      <span>{o.period}</span>
                    </div>
                    <strong>{format(o.value, 0)}</strong>
                    <p>{o.note}</p>
                  </article>
                ))}
              </div>
              <div className="sectionTitle">
                <h2>Показатели</h2>
                <span>{filtered.length} · нарастающим итогом</span>
              </div>
              <div className="kpiGrid">
                {filtered.map((i) => {
                  const s = statusFor(i.fact, i.plan, Boolean(i.reverse));
                  const attainment =
                    i.plan === null
                      ? null
                      : (i.reverse ? i.plan / i.fact : i.fact / i.plan) * 100;
                  return (
                    <article className={`kpi ${s}`} key={i.id}>
                      <div className="kpiTop">
                        <span>{i.group}</span>
                        <i>
                          {s === "good"
                            ? "План"
                            : s === "warn"
                              ? "Риск"
                              : s === "bad"
                                ? "Отклонение"
                                : "План не задан"}
                        </i>
                      </div>
                      <h3>{i.name}</h3>
                      <div className="kpiValue">
                        <strong>
                          {i.quantity !== undefined
                            ? format(i.quantity, 0)
                            : `${format(i.fact)}${i.unit}`}
                        </strong>
                        <small>{i.quantityLabel ?? ""}</small>
                      </div>
                      <div className="shareLine">
                        <span>
                          {i.quantity !== undefined
                            ? `доля ${format(i.fact)}${i.unit}`
                            : ""}
                        </span>
                        {i.plan !== null && (
                          <span>
                            план {i.reverse ? "≤" : "≥"} {format(i.plan)}
                            {i.unit}
                            {i.planPeriod ? ` ${i.planPeriod}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="bar">
                        <span
                          style={{
                            width: `${Math.min(attainment ?? 0, 100)}%`,
                          }}
                        />
                      </div>
                      <div className="kpiFoot">
                        <span>
                          {i.trend === null
                            ? "динамика —"
                            : `${i.trend > 0 ? "↑" : i.trend < 0 ? "↓" : "→"} ${format(Math.abs(i.trend))} п.п. к ${i.compareTo ?? "предыдущему периоду"}`}
                        </span>
                        <span>
                          {i.lag === null
                            ? "по РТ"
                            : `${i.lag} МО/подр. в зоне внимания`}
                        </span>
                      </div>
                      <div className="date">
                        актуальность: {i.date}
                        {i.provisional ? " · предварительно" : ""}
                      </div>
                      {guidance[i.id] && (
                        <details className="kpiGuide">
                          <summary>Что сделать МО</summary>
                          <p>{guidance[i.id].goal}</p>
                          <ul>
                            {guidance[i.id].actions
                              .slice(0, 2)
                              .map((action) => (
                                <li key={action}>{action}</li>
                              ))}
                          </ul>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {tab === "max" && (
            <section className="maxSection">
              <div className="pageHead maxHead">
                <div>
                  <p className="eyebrow">МАХ</p>
                  <h1>Официальный результат РТ и оперативный мониторинг МО</h1>
                  <p>Официальный накопительный результат не используется в недельной или месячной динамике МО.</p>
                </div>
              </div>

              <section className="maxOfficialBlock" aria-label="Официальные данные Республики Татарстан по МАХ">
                <header>
                  <div>
                    <p className="eyebrow">ОФИЦИАЛЬНО ПО РЕСПУБЛИКЕ ТАТАРСТАН</p>
                    <h2>Накопительный результат за 2026 год</h2>
                  </div>
                  <span>Источник: ГИС ЭЗ РТ / МАХ</span>
                </header>
              <div className="maxRegionalCards maxOfficialCards">
                {liveIndicators
                  .filter((item) => ["visitMax", "tmkMax", "elnMax"].includes(item.id))
                  .sort((a, b) => ["visitMax", "tmkMax", "elnMax"].indexOf(a.id) - ["visitMax", "tmkMax", "elnMax"].indexOf(b.id))
                  .map((item) => {
                    const completion = item.plan ? (item.fact / item.plan) * 100 : null;
                    const title = item.id === "visitMax" ? "Запись к врачу посредством МАХ" : item.name.replace(/^Количество\s+/u, "");
                    return (
                      <article
                        key={item.id}
                        className={`maxServiceCard ${
                          maxService ===
                          (item.id === "visitMax" ? "visit" : item.id === "tmkMax" ? "tmk" : "eln")
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          setMaxService(
                            item.id === "visitMax" ? "visit" : item.id === "tmkMax" ? "tmk" : "eln",
                          )
                        }
                      >
                        <small>Официальный факт РТ · накопительно за 2026 год</small>
                        <h2>{title}</h2>
                        <strong>{format(item.fact, 0)}</strong>
                        <p>Годовой план <b>{format(item.plan ?? 0, 0)}</b></p>
                        <div className="maxProgress"><i style={{ width: `${Math.min(completion ?? 0, 100)}%` }} /></div>
                        <footer><b>{completion == null ? "—" : `${format(completion, 2)}%`}</b><span>исполнения плана</span></footer>
                      </article>
                    );
                  })}
              </div>
              </section>

              <section className="maxOperationalBlock" aria-label="Оперативный мониторинг медицинских организаций">
                <header>
                  <div>
                    <p className="eyebrow">ОПЕРАТИВНО ПО МО</p>
                    <h2>Недельная и месячная активность</h2>
                  </div>
                  <span>ТМК и ЛВН: ориентир РТ 10 000 в месяц. План МО не установлен.</span>
                </header>
              <div className="maxServiceSwitch" role="group" aria-label="Сервис МАХ">
                <button className={maxService === "visit" ? "active" : ""} onClick={() => setMaxService("visit")}>Запись к врачу</button>
                <button className={maxService === "tmk" ? "active" : ""} onClick={() => setMaxService("tmk")}>ТМК</button>
                <button className={maxService === "eln" ? "active" : ""} onClick={() => setMaxService("eln")}>ЛВН</button>
              </div>

              {maxService === "visit" && (
                <>
              <div className="maxMonthlyHead">
                <div>
                  <p className="eyebrow">ЗАПИСЬ НА ПРИЁМ К ВРАЧУ</p>
                  <h2>Фактические записи через МАХ по муниципалитетам</h2>
                  <p>Показываются данные источника как есть: муниципалитет × месяц. Привязка к медицинским организациям не выполняется.</p>
                </div>
              </div>

              <div className="maxRegionalCards maxMonthCards">
                {maxAppointmentsMunicipal.months.map((month) => (
                  <article key={month.id}>
                    <small>{month.complete ? "Полный месяц" : "Текущий неполный месяц"}</small>
                    <h2>{month.label}</h2>
                    <strong>{format(maxAppointmentsMunicipal.totals[month.id] ?? 0, 0)}</strong>
                    <p>фактических записей</p>
                  </article>
                ))}
              </div>

              <div className="maxTableWrap">
                <table className="maxTable">
                  <thead>
                    <tr>
                      <th>Муниципалитет</th>
                      {maxAppointmentsMunicipal.months.map((month) => (
                        <th key={month.id}>{month.label.replace(" 2026", "")}</th>
                      ))}
                      <th>Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maxAppointmentsMunicipal.rows.map((row) => (
                      <tr key={row.municipality}>
                        <td><strong>{row.municipality}</strong></td>
                        {maxAppointmentsMunicipal.months.map((month) => (
                          <td key={month.id}>
                            {row.values[month.id] == null ? "—" : format(row.values[month.id] ?? 0, 0)}
                          </td>
                        ))}
                        <td><strong>{format(row.total, 0)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Итого по РТ</td>
                      {maxAppointmentsMunicipal.months.map((month) => (
                        <td key={month.id}><strong>{format(maxAppointmentsMunicipal.totals[month.id] ?? 0, 0)}</strong></td>
                      ))}
                      <td><strong>{format(maxAppointmentsMunicipal.grandTotal, 0)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="maxDataGap">
                <strong>Без привязки к МО</strong>
                <span>Источник не содержит идентификатор медицинской организации. Поэтому значения не распределяются между поликлиниками и больницами и не участвуют в рейтинге МО.</span>
              </div>

                </>
              )}

              {maxService !== "visit" && (
                <>
              <div className="maxMonthlyHead">
                <div>
                  <p className="eyebrow">{maxService === "tmk" ? "ТМК" : "ЛВН"}</p>
                  <h2>{maxService === "tmk" ? "ТМК: работа МО за полный месяц" : "ЛВН после ТМК: работа МО за полный месяц"}</h2>
                  <p>Август рассчитан как разность накопительных срезов на 31.08 и 31.07. Накопительные значения в месячную таблицу не подставляются.</p>
                </div>
                <div className="maxMonthSwitch" aria-label="Выбранный полный месяц">
                  <button className={maxMonth === "2026-07" ? "active" : ""} onClick={() => setMaxMonth("2026-07")}>Июль</button>
                  <button className={maxMonth === "2026-08" ? "active" : ""} onClick={() => setMaxMonth("2026-08")}>Август</button>
                </div>
              </div>

              <div className="maxFilters">
                {([
                  ["volume", "Лидеры по объёму"],
                  ["growth", "Наибольший рост"],
                  ["decline", "Наибольшее падение"],
                  ["zero", "Нет активности"],
                  ["missing", "Нет строки в выгрузке"],
                ] as const).map(([id, label]) => (
                  <button key={id} className={maxFilter === id ? "active" : ""} onClick={() => setMaxFilter(id)}>{label}</button>
                ))}
              </div>

              {maxMonth === "2026-07" ? (
                <div className="maxDataGap">
                  <strong>Июль 2026 пока не рассчитывается</strong>
                  <span>В baseline нет накопительного среза на 30.06.2026 или отдельной июльской выгрузки. Срез на 31.07 нельзя выдавать за месячный объём июля.</span>
                </div>
              ) : (maxFilter === "growth" || maxFilter === "decline") ? (
                <div className="maxDataGap">
                  <strong>Для динамики нужен полный июль</strong>
                  <span>Рост и падение будут рассчитаны после появления сопоставимого июльского месяца. Отсутствующие данные не заменяются нулём.</span>
                </div>
              ) : (
                <div className="maxTableWrap">
                  <table className="maxTable">
                    <thead><tr><th>МО</th><th>{maxService === "tmk" ? "ТМК" : "ЛВН"}</th><th>к июлю</th></tr></thead>
                    <tbody>
                      {visibleMaxRows.map((row) => (
                        <tr key={row.name} onClick={() => setMaxSelectedMo(row.name)}>
                          <td><strong>{row.name}</strong></td>
                          <td>{renderMaxValue(maxService === "tmk" ? row.tmk : row.eln)}</td><td>—</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Итого по сопоставимым строкам</td><td>{format(maxService === "tmk" ? augustMaxTotals.tmk : augustMaxTotals.eln, 0)}</td><td>—</td></tr></tfoot>
                  </table>
                </div>
              )}

              {selectedMaxRow && (
                <div className="maxMoCard">
                  <header><div><small>КАРТОЧКА МО · АВГУСТ 2026</small><h2>{selectedMaxRow.name}</h2></div><button onClick={() => setMaxSelectedMo(null)}>Закрыть</button></header>
                  <div className="maxMoMetrics">
                    <article>
                      <small>{maxService === "tmk" ? "ТМК" : "ЛВН после ТМК"}</small>
                      {renderMaxValue(maxService === "tmk" ? selectedMaxRow.tmk : selectedMaxRow.eln)}
                    </article>
                  </div>
                  <p><b>Управленческий вывод:</b> доступен один полный месяц; вывод о росте или снижении будет сформирован после появления сопоставимого июля.</p>
                  <div className="maxHistory"><span>Июль 2026 · нет сопоставимого среза на 30.06</span><span>Август 2026 · {maxService === "tmk" ? "ТМК" : "ЛВН"} {(maxService === "tmk" ? selectedMaxRow.tmk.value : selectedMaxRow.eln.value) == null ? "нет данных" : format((maxService === "tmk" ? selectedMaxRow.tmk.value : selectedMaxRow.eln.value) ?? 0, 0)}</span></div>
                </div>
              )}

              <details className="maxMethod"><summary>Источник и ограничения текущей версии</summary><p><b>ТМК и ЛВН:</b> файл «ТМК_МАХ», листы 1–3, разрез по МО. Полный август получен из одинаковых накопительных срезов 31.07 → 31.08.</p><p><b>Запись на приём к врачу:</b> файл «Статистика записей к врачу.xlsx», разрез муниципалитет × месяц. Данные показываются по факту без привязки к медицинским организациям. Сентябрь — текущий неполный месяц.</p><p><b>Важно:</b> годовые планы РТ не применяются к отдельным МО; отсутствие строки не считается нулевой активностью.</p></details>
                </>
              )}
              </section>
            </section>
          )}

          {tab === "unified" && (
            <>
              <div className="operationalGrid extendedOperationalGrid">
                {extendedOperational.map((o) => (
                  <article
                    key={o.title}
                    className={`operationalCard ${o.accent}`}
                  >
                    <div>
                      <h3>{o.title}</h3>
                      <span>{o.period}</span>
                    </div>
                    <strong>{format(o.value, 0)}</strong>
                    <p>{o.note}</p>
                  </article>
                ))}
              </div>
              <div className="extendedStats six">
                <article>
                  <small>Всего показателей</small>
                  <strong>{extendedCatalog.length}</strong>
                  <span>карточек без дублей</span>
                </article>
                <article className="federalAchieved">
                  <small>Достигнуты по контрольным срезам</small>
                  <strong className="blue">
                    {extendedFederalAchieved.agreement +
                      extendedFederalAchieved.collegium}
                  </strong>
                  <span>
                    МБТ — {extendedFederalAchieved.agreement} · коллегия —{" "}
                    {extendedFederalAchieved.collegium}
                  </span>
                </article>
                <article>
                  <small>Выполнены по данным РТ</small>
                  <strong className="green">{extendedStats.achieved}</strong>
                  <span>есть сопоставимый факт РТ</span>
                </article>
                <article>
                  <small>Не выполнены по данным РТ</small>
                  <strong className="red">{extendedStats.notAchieved}</strong>
                  <span>есть сопоставимый факт РТ</span>
                </article>
                <article>
                  <small>В контракте</small>
                  <strong className="contractNumber">
                    {extendedStats.contract}
                  </strong>
                  <span>ожидается реализация</span>
                </article>
                <article>
                  <small>Нет данных РТ</small>
                  <strong>{extendedStats.noData}</strong>
                  <span>нет сопоставимого факта</span>
                </article>
              </div>
              <div className="extendedFilters">
                <div className="extendedSearch">
                  <input
                    value={unifiedQuery}
                    onChange={(event) => setUnifiedQuery(event.target.value)}
                    placeholder="Найти показатель или номер пункта"
                  />
                  <span>{extendedRows.length}</span>
                </div>
                <div>
                  <small>По статусу</small>
                  <div role="group" aria-label="Статус показателя">
                    <button
                      className={extendedStatusFilter === "all" ? "active" : ""}
                      onClick={() => setExtendedStatusFilter("all")}
                    >
                      Все
                    </button>
                    <button
                      className={
                        extendedStatusFilter === "exceptContract" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("exceptContract")}
                    >
                      Все, кроме «В контракте»
                    </button>
                    <button
                      className={
                        extendedStatusFilter === "achieved" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("achieved")}
                    >
                      Выполнены
                    </button>
                    <button
                      className={
                        extendedStatusFilter === "notAchieved" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("notAchieved")}
                    >
                      Не выполнены
                    </button>
                    <button
                      className={
                        extendedStatusFilter === "contract" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("contract")}
                    >
                      В контракте
                    </button>
                    <button
                      className={
                        extendedStatusFilter === "noData" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("noData")}
                    >
                      Нет данных РТ
                    </button>
                  </div>
                </div>
                <div>
                  <small>Группа показателей</small>
                  <div role="group" aria-label="Группа показателей">
                    <button
                      className={extendedCategory === "all" ? "active" : ""}
                      onClick={() => setExtendedCategory("all")}
                    >
                      Все
                    </button>
                    <button
                      className={
                        extendedCategory === "integration" ? "active" : ""
                      }
                      onClick={() => setExtendedCategory("integration")}
                    >
                      Интеграция и инфраструктура
                    </button>
                    <button
                      className={
                        extendedCategory === "services" ? "active" : ""
                      }
                      onClick={() => setExtendedCategory("services")}
                    >
                      Цифровые услуги гражданам
                    </button>
                    <button
                      className={
                        extendedCategory === "documents" ? "active" : ""
                      }
                      onClick={() => setExtendedCategory("documents")}
                    >
                      СЭМД и регистры
                    </button>
                    <button
                      className={
                        extendedCategory === "transfer" ? "active" : ""
                      }
                      onClick={() => setExtendedCategory("transfer")}
                    >
                      ТВСП и передача документов
                    </button>
                    <button
                      className={extendedCategory === "doctors" ? "active" : ""}
                      onClick={() => setExtendedCategory("doctors")}
                    >
                      Врачи и электронная подпись
                    </button>
                    <button
                      className={
                        extendedCategory === "medicines" ? "active" : ""
                      }
                      onClick={() => setExtendedCategory("medicines")}
                    >
                      Лекарственное обеспечение
                    </button>
                    <button
                      className={extendedCategory === "ai" ? "active" : ""}
                      onClick={() => setExtendedCategory("ai")}
                    >
                      Искусственный интеллект
                    </button>
                  </div>
                </div>
              </div>
              {[
                {
                  title: "Показатели МБТ",
                  note: "В порядке пунктов соглашения",
                  rows: extendedAgreementRows,
                },
                {
                  title: "Дополнительные показатели коллегии",
                  note: "Только показатели, не представленные в МБТ",
                  rows: extendedCollegiumRows,
                },
              ].map((block) => (
                <section className="extendedSection" key={block.title}>
                  <div className="extendedSectionHead">
                    <div>
                      <h2>{block.title}</h2>
                      <p>{block.note}</p>
                    </div>
                    <b>{block.rows.length}</b>
                  </div>
                  <div className="extendedGrid">
                    {block.rows.map((item) => {
                      const { row } = item;
                      const regionalSourceRow =
                        item.source === "collegium" ? row : item.collegium;
                      const regional = row.regionalId
                        ? calculatedIndicatorById[row.regionalId]
                        : undefined;
                      const regionalFile =
                        !regional && regionalSourceRow?.regionalFact
                          ? federalMetric(regionalSourceRow.regionalFact)
                          : null;
                      const plan = federalMetric(row.plan),
                        federal = federalMetric(row.federal);
                      const regionalFileComparable =
                        regionalFile?.value !== null &&
                        regionalFile?.unit === plan.unit &&
                        plan.value !== null;
                      const regionalStatus = regionalControlStatus(
                        row,
                        item.collegium,
                      );
                      const status = regionalStatus;
                      const deviation = regionalFileComparable
                        ? federalLowerIsBetter(row)
                          ? plan.value! - regionalFile!.value!
                          : regionalFile!.value! - plan.value!
                        : regional && regional.plan !== null
                          ? regional.reverse
                            ? regional.plan - regional.fact
                            : regional.fact - regional.plan
                          : null;
                      const federalDelta =
                        regionalFile?.unit === "%" &&
                        federal.unit === "%" &&
                        regionalFile.value !== null &&
                        federal.value !== null
                          ? regionalFile.value - federal.value
                          : regional &&
                              regional.unit === "%" &&
                              federal.unit === "%" &&
                              federal.value !== null
                            ? regional.fact - federal.value
                            : null;
                      const statusLabel = status === "achieved"
                          ? "Выполнен по данным РТ"
                          : status === "notAchieved"
                            ? "Не выполнен"
                            : status === "contract"
                              ? "В контракте"
                              : "Нет данных РТ";
                      const primaryRegional =
                        regionalFile?.value != null
                          ? regionalFile.display
                          : regional
                            ? regional.unit === "%"
                              ? `${format(regional.fact, 2)}%`
                              : format(regional.quantity ?? regional.fact, 0)
                            : "—";
                      const quantityText =
                        regionalFile?.value != null
                          ? (regionalSourceRow?.regionalPeriod ??
                            "период не указан")
                          : regional?.quantity !== undefined
                            ? `${format(regional.quantity, 0)} ${regional.quantityLabel ?? ""}`.trim()
                            : regional
                              ? regional.quantityLabel
                              : "Сопоставимый региональный расчёт по методике показателя не представлен";
                      const planChip =
                        deviation === null
                          ? "Отклонение от плана —"
                          : regional?.reverse
                            ? deviation >= 0
                              ? `↓ ${format(Math.abs(deviation), 2)} п.п. ниже предела`
                              : `↑ ${format(Math.abs(deviation), 2)} п.п. выше допустимого`
                            : deviation >= 0
                              ? `↑ ${format(Math.abs(deviation), 2)} п.п. выше плана`
                              : `↓ ${format(Math.abs(deviation), 2)} п.п. до плана`;
                      const regionalTrend = regional?.trend ?? null;
                      const trendGood =
                        regionalTrend !== null &&
                        (regional?.reverse
                          ? regionalTrend < 0
                          : regionalTrend > 0);
                      const trendBad =
                        regionalTrend !== null &&
                        (regional?.reverse
                          ? regionalTrend > 0
                          : regionalTrend < 0);
                      const trendLabel =
                        regionalTrend === null
                          ? null
                          : regionalTrend === 0
                            ? "→ без изменения"
                            : trendGood
                              ? `↑ улучшение на ${format(Math.abs(regionalTrend), 2)} п.п.`
                              : `↓ ухудшение на ${format(Math.abs(regionalTrend), 2)} п.п.`;
                      return (
                        <article
                          className={`extendedCard ${status}`}
                          key={item.key}
                        >
                          <div className="extendedCardHead">
                            <span>
                              <b>
                                {item.source === "agreement"
                                  ? `МБТ · пункт ${row.id}`
                                  : `Коллегия · пункт ${row.id}`}
                              </b>
                              {item.collegium ? (
                                <small className="dualControl">
                                  МБТ + Коллегия · пункт {item.collegium.id}
                                </small>
                              ) : (
                                <small>
                                  {item.source === "collegium"
                                    ? "Только коллегия"
                                    : row.type}
                                </small>
                              )}
                            </span>
                            <i>{statusLabel}</i>
                          </div>
                          <h2>{row.name}</h2>
                          {regionalSourceRow?.sourceNote && (
                            <p className="sourceWarning">
                              {regionalSourceRow.sourceNote}
                            </p>
                          )}
                          <div className="extendedValues">
                            <section>
                              <small>План</small>
                              <strong>{plan.display}</strong>
                              {plan.detail && <span>{plan.detail}</span>}
                            </section>
                            <section className="federalReference">
                              <small>Федеральный срез · 6 месяцев</small>
                              <strong>{federal.display}</strong>
                              <span>{federal.detail}</span>
                            </section>
                            <section
                              className={
                                regionalFile || regional ? status : "noData"
                              }
                            >
                              <small>Факт Татарстана</small>
                              <strong>{primaryRegional}</strong>
                              <span>{quantityText}</span>
                              {trendLabel && (
                                <em
                                  className={`regionalTrend ${trendGood ? "improved" : trendBad ? "worsened" : "same"}`}
                                >
                                  {trendLabel}
                                  <small>
                                    к срезу на {regional?.compareTo}
                                  </small>
                                </em>
                              )}
                            </section>
                          </div>
                          <div className="extendedDeviations">
                            <span
                              className={
                                deviation === null
                                  ? "neutral"
                                  : deviation >= 0
                                    ? "positive"
                                    : "negative"
                              }
                            >
                              {planChip}
                            </span>
                            <span className="federalDelta">
                              {federalDelta === null
                                ? "Сравнение с федеральным срезом —"
                                : `${federalDelta >= 0 ? "↑" : "↓"} ${format(Math.abs(federalDelta), 2)} п.п. к федеральному срезу`}
                            </span>
                          </div>
                          <div className="extendedFoot">
                            {regional ? (
                              <button onClick={() => openExtendedMetric(item)}>
                                Открыть по медицинским организациям →
                              </button>
                            ) : (
                              <span>
                                Сопоставимый региональный расчёт по методике
                                показателя не представлен
                              </span>
                            )}
                            {regional && (
                              <time>актуальность: {regional.date}</time>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
              {extendedRows.length === 0 && (
                <div className="unifiedEmpty">
                  <b>По выбранным фильтрам показателей нет</b>
                  <span>
                    Измените статус, смысловую группу или строку поиска.
                  </span>
                </div>
              )}
            </>
          )}

          {tab === "federal" && (
            <>
              <div className="pageHead federalHead">
                <div>
                  <p className="eyebrow">ФЕДЕРАЛЬНЫЙ КОНТРОЛЬ</p>
                  <h1>Показатели на контроле Российской Федерации</h1>
                  <p>
                    План на 2026 год · федеральная оценка за 6 месяцев ·
                    актуальные данные Республики Татарстан при полном совпадении
                    методики
                  </p>
                </div>
                <div className="federalSource">
                  <small>Основание</small>
                  <strong>21.08.2026 № 32031</strong>
                  <span>показатели МАХ исключены</span>
                </div>
              </div>
              <div className="federalSummary">
                <article>
                  <small>Всего показателей</small>
                  <strong>{federalSummaryStats.total}</strong>
                  <span>в выбранном контуре</span>
                </article>
                <article>
                  <small>Достигнуто по оценке РФ</small>
                  <strong className="blue">
                    {federalSummaryStats.federalAchieved}
                  </strong>
                  <span>федеральный срез за 6 месяцев</span>
                </article>
                <article>
                  <small>Выполнено по данным РТ</small>
                  <strong className="green">
                    {federalSummaryStats.regionalAchieved}
                  </strong>
                  <span>актуальные сопоставимые данные</span>
                </article>
                <article>
                  <small>Не выполнено по данным РТ</small>
                  <strong className="red">
                    {federalSummaryStats.regionalNotAchieved}
                  </strong>
                  <span>план не достигнут</span>
                </article>
                <article>
                  <small>В контракте</small>
                  <strong className="contractNumber">
                    {federalSummaryStats.contract}
                  </strong>
                  <span>ожидается реализация</span>
                </article>
                <article>
                  <small>Нет данных РТ</small>
                  <strong>{federalSummaryStats.noData}</strong>
                  <span>нет сопоставимого факта</span>
                </article>
              </div>
              <div
                className="federalSwitch"
                role="group"
                aria-label="Контур федерального контроля"
              >
                <button
                  className={federalSet === "agreement" ? "active" : ""}
                  onClick={() => setFederalSet("agreement")}
                >
                  <b>Соглашение</b>
                  <small>показатели субсидии и цифровизации</small>
                </button>
                <button
                  className={federalSet === "collegium" ? "active" : ""}
                  onClick={() => setFederalSet("collegium")}
                >
                  <b>Коллегия Минздрава России</b>
                  <small>показатели протокола от 17.04.2026</small>
                </button>
              </div>
              <div className="federalToolbar">
                <input
                  value={federalQuery}
                  onChange={(event) => setFederalQuery(event.target.value)}
                  placeholder="Найти показатель или номер"
                />
                <select
                  value={federalStatus}
                  onChange={(event) => setFederalStatus(event.target.value)}
                >
                  <option value="all">Все статусы</option>
                  <option value="except-contract">
                    Все, кроме «В контракте»
                  </option>
                  <option>Достигнут</option>
                  <option>Отклонение</option>
                  <option>В контракте</option>
                  <option>Справочно</option>
                </select>
                <span>{federalRows.length} показателей</span>
              </div>
              <div className="federalNote">
                <b>Правило сопоставления:</b> разница с федеральным уровнем не
                является динамикой. Улучшение и ухудшение рассчитываются только
                к предыдущему срезу РТ. Для долей обязательно показываются
                числитель, знаменатель и количество, необходимое для достижения
                плана.
              </div>
              <div className="tableWrap federalTableWrap">
                <table className="matrix federalTable">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Показатель</th>
                      <th>
                        План<small>2026 год</small>
                      </th>
                      <th>
                        Федеральная оценка<small>6 месяцев 2026 года</small>
                      </th>
                      <th>
                        Факт РТ
                        <small>
                          {federalSet === "collegium"
                            ? "период указан в строке"
                            : "актуальный срез"}
                        </small>
                      </th>
                      <th>
                        К федеральной оценке<small>сравнение долей</small>
                      </th>
                      <th>Статус РТ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {federalRows.map((row) => {
                      const planMetric = federalMetric(row.plan);
                      const federal = federalMetric(row.federal);
                      const regional = row.regionalId
                        ? calculatedIndicatorById[row.regionalId]
                        : undefined;
                      const fileRegional =
                        !regional && row.regionalFact
                          ? federalMetric(row.regionalFact)
                          : null;
                      const regionalIsPercent =
                        fileRegional?.unit === "%" || regional?.unit === "%";
                      const regionalValue =
                        fileRegional?.value ??
                        (regional
                          ? regionalIsPercent
                            ? regional.fact
                            : (regional.quantity ?? regional.fact)
                          : null);
                      const regionalComparableToPlan =
                        regionalValue !== null &&
                        planMetric.value !== null &&
                        ((regionalIsPercent && planMetric.unit === "%") ||
                          (!regionalIsPercent && planMetric.unit === "count"));
                      const regionalStatus = regionalComparableToPlan
                        ? statusFor(
                            regionalValue,
                            planMetric.value,
                            federalLowerIsBetter(row),
                          )
                        : "na";
                      const comparable =
                        regionalValue !== null &&
                        federal.value !== null &&
                        ((regionalIsPercent && federal.unit === "%") ||
                          (!regionalIsPercent && federal.unit === "count"));
                      const delta = comparable
                        ? regionalValue - federal.value
                        : null;
                      const achieved = regionalStatus === "good";
                      const federalAchieved =
                        federal.value !== null &&
                        planMetric.value !== null &&
                        federal.unit === planMetric.unit
                          ? federalLowerIsBetter(row)
                            ? federal.value < planMetric.value
                            : federal.value >= planMetric.value
                          : row.status === "Достигнут";
                      const deltaTone =
                        delta === null
                          ? "na"
                          : achieved
                            ? "good"
                            : delta < 0
                              ? "bad"
                              : "warn";
                      const fallbackStatus =
                        row.status === "Нет расчёта"
                          ? "В контракте"
                          : row.status;
                      const fallbackTone =
                        row.status === "Достигнут"
                          ? "good"
                          : row.status === "Отклонение"
                            ? "bad"
                            : row.status === "Нет расчёта" ||
                                row.status === "В контракте"
                              ? "contract"
                              : "na";
                      const denominator =
                        regionalIsPercent && !fileRegional
                          ? quantityDenominator(regional?.quantityLabel)
                          : null;
                      const target =
                        regional &&
                        regional.plan !== null &&
                        denominator !== null
                          ? Math.ceil((denominator * regional.plan) / 100)
                          : null;
                      const shortage =
                        target !== null && regional?.quantity !== undefined
                          ? Math.max(0, target - regional.quantity)
                          : null;
                      return (
                        <tr key={`${federalSet}-${row.id}`}>
                          <td>
                            <b className="federalNumber">{row.id}</b>
                            <small>{row.type}</small>
                          </td>
                          <td>
                            <strong>{row.name}</strong>
                            <span className="periodTypeChip">
                              {federalPeriodType(row)}
                            </span>
                            {row.sourceNote && (
                              <small className="sourceWarning">
                                {row.sourceNote}
                              </small>
                            )}
                            {row.regionalId && (
                              <small className="matchedSource">
                                Сопоставлена методика; периоды и объёмы указаны
                                отдельно
                              </small>
                            )}
                          </td>
                          <td>
                            <b className="federalMetric">
                              {planMetric.display}
                            </b>
                            {planMetric.detail && (
                              <small>База расчёта: {planMetric.detail}</small>
                            )}
                          </td>
                          <td>
                            <b
                              className={`federalMetric ${federalAchieved ? "good" : "bad"}`}
                            >
                              {federal.display}
                            </b>
                            {federal.detail && federal.unit !== "text" && (
                              <small>Федеральный объём: {federal.detail}</small>
                            )}
                            <small>{federalControl.federalPeriod}</small>
                          </td>
                          <td>
                            {regionalValue !== null ? (
                              <>
                                <b
                                  className={`federalMetric ${regionalStatus === "good" ? "good" : regionalStatus === "bad" ? "bad" : "warn"}`}
                                >
                                  {fileRegional?.display ??
                                    (regionalIsPercent
                                      ? `${format(regionalValue, 2)}%`
                                      : format(regionalValue, 0))}
                                </b>
                                {regional?.quantity !== undefined &&
                                  regional.quantityLabel && (
                                    <small>
                                      {format(regional.quantity, 0)}{" "}
                                      {regional.quantityLabel}
                                    </small>
                                  )}
                                {target !== null && (
                                  <small>
                                    План при текущем объёме: {format(target, 0)}
                                    {shortage !== null && shortage > 0
                                      ? ` · не хватает ${format(shortage, 0)}`
                                      : ""}
                                  </small>
                                )}
                                <small>
                                  {fileRegional
                                    ? row.regionalPeriod
                                    : `на ${regional?.date}`}
                                </small>
                              </>
                            ) : (
                              <span className="noComparable">
                                Нет сопоставимых данных
                              </span>
                            )}
                          </td>
                          <td>
                            {delta !== null ? (
                              <>
                                <b
                                  className={`federalMetric federalDelta ${deltaTone}`}
                                >
                                  {delta > 0
                                    ? "Выше"
                                    : delta < 0
                                      ? "Ниже"
                                      : "На уровне"}{" "}
                                  {delta !== 0
                                    ? `${format(Math.abs(delta), regionalIsPercent ? 2 : 0)}${regionalIsPercent ? " п.п." : ""}`
                                    : ""}
                                </b>
                                <small>
                                  это сравнение уровней, не динамика
                                </small>
                              </>
                            ) : (
                              <span className="noComparable">
                                Нет сопоставимого значения
                              </span>
                            )}
                          </td>
                          <td>
                            {regionalValue !== null ? (
                              <span
                                className={`federalStatus ${regionalStatus}`}
                              >
                                {regionalStatus === "good"
                                  ? "План достигнут"
                                  : regionalStatus === "na"
                                    ? "Нет сопоставимого плана"
                                    : "Отклонение"}
                              </span>
                            ) : (
                              <span className={`federalStatus ${fallbackTone}`}>
                                {fallbackStatus}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="prototypeNote">
                Федеральная оценка: {federalControl.source}.
                {federalSet === "collegium" && (
                  <>
                    {" "}
                    Региональный факт:{" "}
                    {federalControl.collegiumRegionalSource ??
                      "Показатели по коллегии.xlsx"}
                    .
                  </>
                )}{" "}
                Показатели МАХ в этот раздел не включены. Их оперативный
                контроль остаётся в соответствующих региональных разделах
                дашборда.
              </p>
            </>
          )}

          {tab === "ranking" && (
            <>
              <div className="pageHead ratingHead">
                <div>
                  <p className="eyebrow">ПОСЛЕДНИЙ ПОЛНЫЙ МЕСЯЦ</p>
                  <h1>Рейтинг медицинских организаций — {latestFullMonth.label}</h1>
                  {/* Baseline v4.6.0: Рейтинг медицинских организаций — август 2026 */}
                  <p>
                    МО сравниваются только внутри своего типа · {reportingPeriods.hasPartialNewerMonth
                      ? `${reportingPeriods.latestObservedMonth.adjective} оперативные срезы на места не влияют`
                      : "оперативные срезы после закрытого месяца отсутствуют"}
                    {/* Baseline v4.6.0: сентябрьские оперативные срезы на места не влияют */}
                  </p>
                </div>
                <div className="ratingFormula">
                  <small>Период рейтинга</small>
                  <strong>{ratingPeriodShort}</strong>
                  <span>динамика: {latestMonthName} к {previousMonthDative} {previousFullMonth.year}</span>
                </div>
              </div>
              <div
                className="ratingViewSwitch"
                role="group"
                aria-label="Разрез рейтинга"
              >
                <button
                  className={ratingView === "types" ? "active" : ""}
                  onClick={() => setRatingView("types")}
                >
                  <b>По типам МО</b>
                  <small>сопоставимые организации</small>
                </button>
                <button
                  className={ratingView === "unions" ? "active" : ""}
                  onClick={() => setRatingView("unions")}
                >
                  <b>По объединениям</b>
                  <small>результат курируемых территорий</small>
                </button>
              </div>
              {ratingView === "unions" ? (
                <>
                  <details className="ratingMethod unionMethod" open>
                    <summary>
                      <span>
                        <b>Методика рейтинга объединений</b>
                        <small>кураторы в расчёте не участвуют</small>
                      </span>
                      <i>⌄</i>
                    </summary>
                    <div>
                      <article>
                        <strong>равный вес</strong>
                        <b>Каждая курируемая МО</b>
                        <p>
                          Сначала рассчитывается итоговый балл каждой
                          государственной МО. Размер и объём организации на вес
                          не влияют.
                        </p>
                      </article>
                      <article>
                        <strong>средний балл</strong>
                        <b>Место объединения</b>
                        <p>
                          Среднее итоговых баллов всех курируемых МО. При
                          равенстве учитываются доля лидеров, число отстающих и
                          полнота.
                        </p>
                      </article>
                      <article>
                        <strong>80%</strong>
                        <b>Контроль полноты</b>
                        <p>
                          При полноте ниже порога рейтинг помечается как
                          предварительный и не трактуется как подтверждённое
                          лидерство.
                        </p>
                      </article>
                      <p>
                        <b>Состав:</b> только государственные МО закреплённых
                        районов и городов. Частные МО, ФАП и отдельные
                        подразделения не учитываются. БСМП, АММБ, РКБ, ГКБ №7,
                        МКДЦ и НЦРМБ показаны как кураторы и исключены из балла
                        своих объединений.
                      </p>
                    </div>
                  </details>
                  <div className="unionCards">
                    {unionRatingRows.map((union, index) => (
                      <article
                        key={union.name}
                        className={union.provisional ? "provisional" : ""}
                      >
                        <div className="unionPlace">
                          <span>{index + 1}</span>
                          <div>
                            <small>Куратор</small>
                            <h2>{union.name}</h2>
                          </div>
                          <b>
                            {union.score === null
                              ? "—"
                              : format(union.score, 1)}
                          </b>
                        </div>
                        <div className="unionMetrics">
                          <p>
                            <small>Курируемых МО</small>
                            <strong>{union.members.length}</strong>
                          </p>
                          <p>
                            <small>Медиана</small>
                            <strong>
                              {union.median === null
                                ? "—"
                                : format(union.median, 1)}
                            </strong>
                          </p>
                          <p>
                            <small>МО ≥95 баллов</small>
                            <strong>
                              {union.leaders} из {union.rated}
                            </strong>
                          </p>
                          <p>
                            <small>МО ниже 80</small>
                            <strong className={union.attention ? "red" : ""}>
                              {union.attention}
                            </strong>
                          </p>
                          <p>
                            <small>Полнота данных</small>
                            <strong>{format(union.coverage, 0)}%</strong>
                          </p>
                          <p>
                            <small>К июню</small>
                            <strong>
                              {union.change === null
                                ? "—"
                                : `${union.change > 0 ? "↑" : union.change < 0 ? "↓" : "→"} ${format(Math.abs(union.change), 1)}`}
                            </strong>
                          </p>
                        </div>
                        {union.provisional && (
                          <div className="unionWarning">
                            Предварительный результат: полнота данных ниже 80%
                          </div>
                        )}
                        <details className="unionMembers">
                          <summary>
                            Показать рейтинг {union.members.length} курируемых
                            МО
                          </summary>
                          <div>
                            {union.members.map((row, memberIndex) => (
                              <p key={row.key}>
                                <i>{memberIndex + 1}</i>
                                <span>{cleanMoName(row.name)}</span>
                                <b>
                                  {row.score === null
                                    ? "Нет данных"
                                    : format(row.score, 1)}
                                </b>
                                <em>{format(row.coverage, 0)}% данных</em>
                              </p>
                            ))}
                          </div>
                        </details>
                      </article>
                    ))}
                  </div>
                  <p className="prototypeNote">
                    Рейтинг объединений построен по результатам последнего
                    полного месяца. Куратор отвечает за результат закреплённых
                    государственных МО, но его собственный балл в результат
                    объединения не включён.
                  </p>
                </>
              ) : (
                <>
                  <div className="ratingTypeTabs">
                    {ratingTypes.map((type) => (
                      <button
                        key={type}
                        className={ratingType === type ? "active" : ""}
                        onClick={() => setRatingType(type)}
                      >
                        <span>{type}</span>
                        <b>
                          {ratingRows.filter((r) => r.type === type).length}
                        </b>
                      </button>
                    ))}
                  </div>
                  <details className="ratingMethod" open>
                    <summary>
                      <span>
                        <b>Методика расчёта рейтинга</b>
                        <small>
                          {latestFullMonth.label} · последний полный месяц
                        </small>
                      </span>
                      <i>⌄</i>
                    </summary>
                    <div>
                      <article>
                        <strong>70%</strong>
                        <b>Сопровождение случаев</b>
                        <p>
                          СЭМД №228, амбулаторные и выписные эпикризы —
                          результат МО за {latestMonthName} либо накопительный срез на {latestFullMonth.endDate.slice(0, 5)} — согласно периодичности показателя.
                        </p>
                      </article>
                      <article>
                        <strong>20%</strong>
                        <b>Цифровые услуги</b>
                        <p>
                          В рейтинг включена доля медицинских свидетельств о
                          смерти за {latestMonthName}. Показатели ЕПГУ и свидетельств о
                          рождении остаются в мониторинге, но из рейтинга
                          исключены.
                        </p>
                      </article>
                      <article>
                        <strong>10%</strong>
                        <b>Блок ТВСП</b>
                        <p>
                          ТВСП учитываются накопительным итогом на {latestFullMonth.endDate.slice(0, 5)}. Динамика
                          показывается только при наличии сопоставимого среза на {previousFullMonth.endDate.slice(0, 5)}.
                        </p>
                      </article>
                      <p>
                        <b>Дополнительно исключено:</b> рассмотрение заявлений
                        за 2 рабочих дня — показатель признан некорректным для
                        рейтинга. <b>Баллы:</b> результат {latestMonthGenitive} ÷ план × 100,
                        максимум — 100. Неприменимый показатель исключается;
                        обязательный показатель без строки помечается «Нет данных»
                        и не получает фиктивного нулевого результата.
                      </p>
                    </div>
                  </details>
                  <div className="ratingSummary">
                    <article>
                      <small>МО в группе</small>
                      <strong>{currentRating.length}</strong>
                    </article>
                    <article>
                      <small>Средний балл</small>
                      <strong>
                        {format(
                          rankedCurrent.reduce(
                            (s, r) => s + (r.score ?? 0),
                            0,
                          ) / Math.max(1, rankedCurrent.length),
                          1,
                        )}
                      </strong>
                    </article>
                    <article>
                      <small>Среднее выполнение</small>
                      <strong>
                        {format(
                          currentRating.reduce(
                            (s, r) =>
                              s + (r.passed / Math.max(1, r.total)) * 100,
                            0,
                          ) / Math.max(1, currentRating.length),
                          0,
                        )}
                        %
                      </strong>
                    </article>
                    <article>
                      <small>Нет данных для балла</small>
                      <strong className="red">
                        {currentRating.filter((r) => r.score === null).length}
                      </strong>
                    </article>
                  </div>
                  <div className="ratingPanels">
                    <RatingPanel
                      title="Топ-5 группы"
                      subtitle="пять максимальных интегральных баллов"
                      rows={rankedCurrent.slice(0, 5)}
                      tone="good"
                    />
                    <RatingPanel
                      title="Требуют внимания"
                      subtitle="минимальный интегральный балл"
                      rows={[...rankedCurrent]
                        .sort(
                          (a, b) =>
                            (a.score ?? Infinity) - (b.score ?? Infinity) ||
                            a.name.localeCompare(b.name, "ru"),
                        )
                        .slice(0, 5)}
                      tone="bad"
                    />
                    <RatingPanel
                      title="Наибольший рост"
                      subtitle={`${latestMonthName} по сравнению с ${previousMonthInstrumental}`}
                      rows={[...currentRating]
                        .filter((r) => r.change !== null)
                        .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
                        .slice(0, 5)}
                      tone="warn"
                      showChange
                    />
                  </div>
                  <div className="allMosHead ratingAllHead">
                    <div>
                      <p className="eyebrow">ПОЛНАЯ РАСШИФРОВКА</p>
                      <h2>{ratingType}</h2>
                      <p>
                        Место определяется баллом; при равенстве — полнотой
                        данных и названием МО
                      </p>
                    </div>
                    <span>{currentRating.length} МО</span>
                  </div>
                  <div className="toolbar">
                    <input
                      value={ratingQuery}
                      onChange={(e) => setRatingQuery(e.target.value)}
                      placeholder="Найти медицинскую организацию"
                    />
                    <span className="sortHint">
                      Нажмите «Расшифровка», чтобы увидеть вклад каждого
                      показателя
                    </span>
                  </div>
                  <div className="tableWrap">
                    <table className="matrix ratingTable">
                      <thead>
                        <tr>
                          <th>
                            <button
                              className={
                                ratingSortKey === "place" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("place")}
                            >
                              Место{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "place",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "name" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("name")}
                            >
                              Медицинская организация{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "name",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "score" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("score")}
                            >
                              Итоговый балл{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "score",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "care" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("care")}
                            >
                              По случаям · 70%{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "care",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "services" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("services")}
                            >
                              Услуги · 20%{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "services",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            ТВСП<small>накопительно на {latestFullMonth.endDate.slice(0, 5)}</small>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "passed" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("passed")}
                            >
                              Выполнено{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "passed",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "change" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("change")}
                            >
                              Динамика балла{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "change",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "coverage" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("coverage")}
                            >
                              Полнота обязательных данных{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "coverage",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                          <th>
                            <button
                              className={
                                ratingSortKey === "status" ? "sorted" : ""
                              }
                              onClick={() => setRatingSort("status")}
                            >
                              Статус{" "}
                              <i>
                                {sortMark(
                                  ratingSortKey === "status",
                                  ratingSortDirection,
                                )}
                              </i>
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRating.map((r) => {
                          const rankedIndex = rankedCurrent.findIndex(
                            (x) => x.key === r.key,
                          );
                          const place =
                            rankedIndex < 0 ? null : rankedIndex + 1;
                          return (
                            <tr key={r.key}>
                              <td>
                                <b className="rank">{place ?? "—"}</b>
                              </td>
                              <td>
                                <strong>{cleanMoName(r.name)}</strong>
                                <details className="ratingBreakdown">
                                  <summary>
                                    Расшифровка: {r.dataCount} из {r.total}{" "}
                                    обязательных показателей с данными
                                  </summary>
                                  <div>
                                    {r.details.map((d) => (
                                      <p key={d.id}>
                                        <span>{d.name}</span>
                                        <b>
                                          {d.numerator !== null &&
                                          d.denominator !== null
                                            ? `${format(d.numerator, 0)} из ${format(d.denominator, 0)} · `
                                            : ""}
                                          {format(d.fact, 2)}%
                                          <small>
                                            план {format(d.plan, 2)}%
                                          </small>
                                        </b>
                                        <em>{format(d.score, 1)} балла</em>
                                      </p>
                                    ))}
                                    {r.missing.map((name) => (
                                      <p
                                        className="missingRating"
                                        key={`missing-${name}`}
                                      >
                                        <span>{name}</span>
                                        <b>Нет данных за {latestMonthName}</b>
                                        <em>без оценки</em>
                                      </p>
                                    ))}
                                  </div>
                                </details>
                              </td>
                              <td>
                                <b className="ratingScore">
                                  {r.score === null ? "—" : format(r.score, 1)}
                                </b>
                                <small>
                                  {r.score === null ? "нет данных" : "из 100"}
                                </small>
                              </td>
                              <td>
                                <b>{format(r.blocks.care, 1)}</b>
                                <small>вес 70%</small>
                              </td>
                              <td>
                                <b>{format(r.blocks.services, 1)}</b>
                                <small>вес 20%</small>
                              </td>
                              <td>
                                <b>{format(r.blocks.readiness, 1)}</b>
                                <small>вес 10%</small>
                              </td>
                              <td>
                                <b>
                                  {r.passed} из {r.total}
                                </b>
                                <small>
                                  {format(
                                    (r.passed / Math.max(1, r.total)) * 100,
                                    0,
                                  )}
                                  %
                                </small>
                              </td>
                              <td>
                                <span
                                  className={`trendPill ${(r.change ?? 0) > 0 ? "up" : (r.change ?? 0) < 0 ? "down" : ""}`}
                                >
                                  {r.change === null
                                    ? "нет сопоставимого набора"
                                    : `${r.change > 0 ? "↑" : r.change < 0 ? "↓" : "→"} ${format(Math.abs(r.change), 1)} балла`}
                                </span>
                              </td>
                              <td>
                                <b>{format(r.coverage, 0)}%</b>
                                <small>
                                  {r.dataCount} из {r.total}
                                </small>
                              </td>
                              <td>
                                <span
                                  className={`statusChip ${r.score === null ? "na" : r.score >= 95 ? "good" : r.score >= 80 ? "warn" : r.score >= 50 ? "bad" : "critical"}`}
                                >
                                  {r.score === null
                                    ? "Нет данных"
                                    : r.score >= 95
                                      ? "Лидер"
                                      : r.score >= 80
                                        ? "Близко к выполнению"
                                        : r.score >= 50
                                          ? "Требует внимания"
                                          : "Критическое отставание"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="prototypeNote">
                    Тип МО и перечень применимых показателей взяты из
                    справочника «МО по показателям». ДРКБ и РКБ занимают по
                    одному месту. ДЦ МЗ РТ и самостоятельные ССМП в сводном
                    рейтинге не участвуют.
                  </p>
                </>
              )}
            </>
          )}

          {tab === "hearings" && (
            <>
              <div className="pageHead hearingHead">
                <div>
                  <p className="eyebrow">ОПЕРАТИВНЫЙ УПРАВЛЕНЧЕСКИЙ КОНТРОЛЬ</p>
                  <h1>МО для заслушивания</h1>
                  <p>
                    В первую очередь — МО с наибольшим вкладом в недостижение
                    региональных целей; полный профиль показателей сохранён
                  </p>
                </div>
                <div className="hearingPeriod">
                  <small>Последние срезы</small>
                  <strong>до 07.09.2026</strong>
                  <span>период каждого показателя указан в расшифровке</span>
                </div>
              </div>
              <div className="hearingStats">
                <article>
                  <small>ТОП-10 формируют</small>
                  <strong className="red">
                    {format(hearingImpactSummary.topTenShare, 1)}%
                  </strong>
                  <span>совокупного рассчитанного дефицита</span>
                </article>
                <article className="heard">
                  <small>Заслушаны</small>
                  <strong>
                    {hearingRows.filter((row) => row.heard).length}
                  </strong>
                  <span>статус и контрольная точка зафиксированы</span>
                </article>
                <article>
                  <small>Заслушать обязательно</small>
                  <strong className="red">
                    {
                      hearingRows.filter(
                        (row) => row.level === "mandatory" && !row.heard,
                      ).length
                    }
                  </strong>
                  <span>ещё не заслушаны</span>
                </article>
                <article>
                  <small>Усиленный контроль</small>
                  <strong className="amber">
                    {
                      hearingRows.filter(
                        (row) => row.level === "control" && !row.heard,
                      ).length
                    }
                  </strong>
                  <span>предупредить и проверить</span>
                </article>
                <article>
                  <small>Плохие, но мало влияют</small>
                  <strong>{hearingImpactSummary.severeLowImpact.length}</strong>
                  <span>≥3 проблем, вклад менее 0,1 п.п.</span>
                </article>
                <article>
                  <small>Нет полных данных</small>
                  <strong>
                    {hearingRows.filter((row) => row.coverage < 100).length}
                  </strong>
                  <span>обязательный показатель отсутствует</span>
                </article>
              </div>
              <details className="hearingMethod">
                <summary>Как рассчитывается приоритет заслушивания</summary>
                <div>
                  <p>
                    <b>1</b>
                    <span>целевое количество = план × знаменатель МО</span>
                  </p>
                  <p>
                    <b>2</b>
                    <span>дефицит = MAX(0; цель − фактический числитель)</span>
                  </p>
                  <p>
                    <b>3</b>
                    <span>вклад, п.п. = дефицит МО ÷ знаменатель РТ × 100</span>
                  </p>
                </div>
                <em>
                  В расчёт входят только долевые показатели с планом и
                  достоверными числителем и знаменателями МО и РТ. Ошибки РЭМД,
                  краткий ввод, КДЛ и другие исключённые показатели остаются в
                  полном профиле как справочные сигналы риска.
                </em>
              </details>
              <details className="hearingMethod hearingTopTen" open>
                <summary>
                  ТОП-10 МО по влиянию на результат Республики Татарстан
                </summary>
                <div>
                  {hearingImpactSummary.topTen.map((row, index) => (
                    <p key={row.key}>
                      <b>{index + 1}</b>
                      <span>
                        {cleanMoName(row.name)} — {format(row.regionalContribution, 3)} п.п.
                      </span>
                    </p>
                  ))}
                </div>
                <em>
                  Вместе: {format(hearingImpactSummary.topTenContribution, 3)} п.п., или {format(hearingImpactSummary.topTenShare, 1)}% рассчитанного совокупного дефицита.
                </em>
              </details>
              <div className="hearingToolbar">
                <input
                  value={hearingQuery}
                  onChange={(event) => setHearingQuery(event.target.value)}
                  placeholder="Найти медицинскую организацию"
                />
                <select
                  value={hearingType}
                  onChange={(event) => setHearingType(event.target.value)}
                >
                  {hearingTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <div role="group" aria-label="Уровень контроля">
                  <button
                    className={hearingLevel === "all" ? "active" : ""}
                    onClick={() => setHearingLevel("all")}
                  >
                    Все
                  </button>
                  <button
                    className={hearingLevel === "mandatory" ? "active" : ""}
                    onClick={() => setHearingLevel("mandatory")}
                  >
                    Заслушать
                  </button>
                  <button
                    className={hearingLevel === "control" ? "active" : ""}
                    onClick={() => setHearingLevel("control")}
                  >
                    Контроль
                  </button>
                  <button
                    className={hearingLevel === "heard" ? "active" : ""}
                    onClick={() => setHearingLevel("heard")}
                  >
                    Заслушаны
                  </button>
                </div>
                <span>{visibleHearingRows.length} МО</span>
              </div>
              <div className="hearingChangeToolbar">
                <b>Динамика показателей заслушанных МО</b>
                <div role="group" aria-label="Динамика показателей">
                  <button
                    className={hearingChangeFilter === "all" ? "active" : ""}
                    onClick={() => setHearingChangeFilter("all")}
                  >
                    Все
                  </button>
                  <button
                    className={
                      hearingChangeFilter === "worsened"
                        ? "active worsened"
                        : "worsened"
                    }
                    onClick={() => setHearingChangeFilter("worsened")}
                  >
                    ↓ Ухудшились
                  </button>
                  <button
                    className={
                      hearingChangeFilter === "improved"
                        ? "active improved"
                        : "improved"
                    }
                    onClick={() => setHearingChangeFilter("improved")}
                  >
                    ↑ Улучшились
                  </button>
                  <button
                    className={
                      hearingChangeFilter === "same" ? "active same" : "same"
                    }
                    onClick={() => setHearingChangeFilter("same")}
                  >
                    → Без изменений
                  </button>
                </div>
              </div>
              <div className="hearingList">
                {visibleHearingRows.map((row, index) => {
                  const snapshotSummary = hearingSnapshotSummary(row);
                  return (
                    <article
                      key={row.key}
                      className={`${row.level}${row.heard ? " heard" : ""}`}
                    >
                      <div className="hearingRank">
                        <i>{index + 1}</i>
                        <div>
                          <h2>{cleanMoName(row.name)}</h2>
                          <p>{row.type}</p>
                        </div>
                        <strong>
                          {format(row.regionalContribution, 3)} п.п.
                          <small>потенциал для РТ</small>
                        </strong>
                        <span>
                          {row.heard
                            ? "Заслушана"
                            : row.level === "mandatory"
                              ? "Заслушать"
                              : "Контроль"}
                        </span>
                      </div>
                      {row.heard && snapshotSummary.snapshot && (
                        <div className="hearingSnapshotSummary">
                          <div>
                            <small>Контрольная точка</small>
                            <b>{snapshotSummary.snapshot.fixedAt ?? hearingSnapshots.fixedAt}</b>
                            <span>
                              показатели восстановлены из версии на момент
                              фиксации статуса
                            </span>
                          </div>
                          <p className="improved">
                            <small>Улучшилось</small>
                            <b>{snapshotSummary.improved}</b>
                          </p>
                          <p className="worsened">
                            <small>Ухудшилось</small>
                            <b>{snapshotSummary.worsened}</b>
                          </p>
                          <p>
                            <small>Без изменения</small>
                            <b>{snapshotSummary.same}</b>
                          </p>
                          <p>
                            <small>Сопоставлено</small>
                            <b>{snapshotSummary.comparable}</b>
                          </p>
                          <p>
                            <small>Текущий вклад</small>
                            <b>{format(row.regionalContribution, 3)} п.п.</b>
                            <span>исторический знаменатель РТ в baseline не сохранён</span>
                          </p>
                        </div>
                      )}
                      <div className="hearingSignals">
                        <p>
                          <small>Критических показателей</small>
                          <b>
                            {row.failedCount} из {row.total}
                          </b>
                        </p>
                        <p>
                          <small>Совокупный вклад</small>
                          <b>{format(row.regionalContribution, 3)} п.п.</b>
                        </p>
                        <p>
                          <small>Показателей с данными</small>
                          <b>{row.dataCount}</b>
                        </p>
                        <p>
                          <small>Нет обязательных данных</small>
                          <b className={row.missingCount ? "red" : ""}>
                            {row.missingCount}
                          </b>
                        </p>
                        <p>
                          <small>Полнота обязательных</small>
                          <b>{format(row.coverage, 0)}%</b>
                        </p>
                      </div>
                      <div className="hearingReason">
                        <div>
                          <small>Главная причина включения</small>
                          <b>
                            {row.mainProblem?.name ??
                              "Обязательные данные не представлены"}
                          </b>
                          {row.mainProblem && (
                            <span>
                              {row.mainProblem.fact === null
                                ? "нет актуальной строки в источнике"
                                : `${row.mainProblem.count !== null && row.mainProblem.volume !== null ? `${format(row.mainProblem.count, 0)} из ${format(row.mainProblem.volume, 0)} · ` : ""}${format(row.mainProblem.fact, 2)}${row.mainProblem.unit} при плане ${format(row.mainProblem.plan, 2)}${row.mainProblem.unit} · вклад ${format(row.mainProblem.regionalContribution ?? 0, 3)} п.п.`}
                            </span>
                          )}
                        </div>
                        <p>
                          <small>Потенциально до цели</small>
                          <b>
                            {row.quantityGap > 0
                              ? format(row.quantityGap, 0)
                              : "не определён"}
                          </b>
                        </p>
                      </div>
                      <details className="hearingDetails">
                        <summary>
                          Показатели по медицинской организации (
                          {
                            hearingMetricsForDisplay(row, hearingChangeFilter)
                              .length
                          }{" "}
                          из {row.metrics.length})
                        </summary>
                        <div>
                          {hearingMetricGroupsForDisplay(row, hearingChangeFilter).map(({ group, metrics }) => (
                            <section className="hearingMetricGroup" key={group.code}>
                              <h4>{group.label}</h4>
                              {metrics.map((metric) => {
                            const comparison = hearingMetricChange(
                              row.key,
                              metric,
                            );
                            const neutralMissing =
                              metric.id === "death" &&
                              metric.status === "missing";
                            return (
                              <p
                                className={`hearingMetric ${metric.status}${metric.status === "missing" ? " missingRating" : ""} change-${comparison.direction}`}
                                key={metric.id}
                              >
                                <span>
                                  {metric.name}
                                  <small>
                                    {metric.period} · срез {metric.date}
                                  </small>
                                  {metric.detail && (
                                    <small>{metric.id === "remd-registration-errors" ? "ТОП ошибок" : "Комментарий"}: {metric.detail}</small>
                                  )}
                                  <small>
                                    Статус: {metric.applicable === false
                                      ? "Неприменимо"
                                      : metric.status === "missing"
                                        ? "Нет данных"
                                        : metric.regionalContribution !== null && metric.regionalContribution !== undefined
                                          ? "Влияет на приоритет"
                                          : "Справочно"}
                                    {metric.regionalContribution !== null && metric.regionalContribution !== undefined
                                      ? ` · влияние ${format(metric.regionalContribution, 3)} п.п. РТ`
                                      : ""}
                                  </small>
                                  {row.heard && comparison.baseline && (
                                    <small>
                                      на дату фиксации:{" "}
                                      {comparison.baseline.fact === null
                                        ? "нет данных"
                                        : `${format(comparison.baseline.fact, 2)}${comparison.baseline.unit}`}{" "}
                                      · срез {comparison.baseline.date}
                                    </small>
                                  )}
                                </span>
                                <b>
                                  {metric.fact === null
                                    ? "Нет данных"
                                    : `${metric.count !== null && metric.volume !== null ? `${format(metric.count, 0)} из ${format(metric.volume, 0)} · ` : ""}${format(metric.fact, 2)}${metric.unit}`}
                                  <small>
                                    {metric.plan === null
                                      ? "без персонального плана МО"
                                      : `план ${format(metric.plan, 2)}${metric.unit}`}
                                  </small>
                                </b>
                                <em className={comparison.direction}>
                                  {comparison.change === null
                                    ? neutralMissing
                                      ? "нет данных · не оценивается"
                                      : metric.applicable === false
                                        ? "неприменимо · не влияет"
                                      : metric.status === "reference"
                                        ? "справочно · не влияет"
                                        : metric.status === "missing"
                                          ? "обязательный показатель"
                                          : metric.passed
                                            ? "выполнен"
                                            : "не выполнен"
                                    : `${comparison.direction === "improved" ? "↑ улучшение" : comparison.direction === "worsened" ? "↓ ухудшение" : "→ без изменения"} · ${format(Math.abs(comparison.change), 2)}${metric.unit === "%" ? " п.п." : ` ${metric.unit}`}`}
                                </em>
                              </p>
                            );
                              })}
                            </section>
                          ))}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {tab === "incident38" && (
            <>
              <div className="pageHead incidentHead">
                <div>
                  <p className="eyebrow">ДОСТУПНОСТЬ ЗАПИСИ НА ПРИЁМ</p>
                  <h1>Инцидент 38 — запись на приём к врачу</h1>
                  <p>
                    Отдельный управленческий контроль дистанционных каналов
                    записи и технических ошибок
                  </p>
                </div>
                <div className="asofPanel">
                  <small>Последний доступный срез</small>
                  <strong>06.08.2026</strong>
                </div>
              </div>
              <div className="incidentHero">
                <article>
                  <small>Записи посредством МАХ</small>
                  <strong>964</strong>
                  <span>подтверждено исходником ЦЦТ РТ</span>
                </article>
                <article>
                  <small>Сервис записи через МАХ</small>
                  <strong className="green">Реализован</strong>
                  <span>бинарный показатель: есть успешные записи</span>
                </article>
                <article className="missing">
                  <small>Доля дистанционных записей</small>
                  <strong>—</strong>
                  <span>нет полного числителя и знаменателя</span>
                </article>
                <article className="missing">
                  <small>Доля технических ошибок</small>
                  <strong>—</strong>
                  <span>нет выгрузки попыток записи и ошибок</span>
                </article>
              </div>
              <section className="incidentMethod">
                <div>
                  <p className="eyebrow">МЕТОДИКА ФЕДЕРАЛЬНОГО ПОКАЗАТЕЛЯ</p>
                  <h2>Доля записей, совершённых гражданами дистанционно</h2>
                  <strong>
                    (дистанционные записи ÷ все записи в рамках ОМС) × 100%
                  </strong>
                </div>
                <div className="incidentParts">
                  <article>
                    <small>В числитель входят</small>
                    <p>
                      ЕПГУ, витрина НСУД, региональный портал, колл-центр,
                      инфомат, АРМ медицинского специалиста, МАХ и иные
                      дистанционные каналы.
                    </p>
                  </article>
                  <article>
                    <small>Знаменатель</small>
                    <p>
                      Общее количество записей на приём в рамках ОМС за тот же
                      отчётный период.
                    </p>
                  </article>
                  <article>
                    <small>Периодичность</small>
                    <p>Ежемесячно, нарастающим итогом.</p>
                  </article>
                  <article>
                    <small>Для рейтинга по МО</small>
                    <p>
                      Нужна полная выгрузка записей и ошибок в разрезе
                      медицинских организаций.
                    </p>
                  </article>
                </div>
              </section>
              <div className="incidentDataNeed">
                <b>Какие исходники необходимо добавить</b>
                <ol>
                  <li>Все записи на приём по каналам и МО.</li>
                  <li>Общее количество записей в рамках ОМС.</li>
                  <li>Успешные, организационные и технические ошибки.</li>
                  <li>Сопоставимый предыдущий накопительный срез.</li>
                </ol>
              </div>
              <p className="prototypeNote">
                Количество записей через МАХ не является долей дистанционных
                записей и пока не участвует в интегральном рейтинге МО. После
                загрузки полной выгрузки раздел будет дополнен сравнением
                организаций.
              </p>
            </>
          )}

          {tab === "waybill" && (
            <>
              <div className="pageHead waybillHead">
                <h1>Электронный путевой лист</h1>
                <div className="asofPanel">
                  <small>
                    {waybillMode === "week" ? "Текущая неделя" : "Полный месяц"}
                  </small>
                  <strong>
                    {waybillMode === "week"
                      ? electronicWaybillWeekly.current.period
                      : electronicWaybill.period}
                  </strong>
                </div>
              </div>
              <section className="waybillDynamics">
                <div className="dynamicsHead">
                  <div>
                    <b>
                      {waybillMode === "week"
                        ? "Недельная динамика"
                        : "Последний полный месяц"}
                    </b>
                    <span>
                      {waybillMode === "week"
                        ? "Региональные итоги двух полных недель; детализация МО — по текущему срезу"
                        : "Июль показан отдельно от оперативных недель августа"}
                    </span>
                  </div>
                  <div
                    className="modeSwitch"
                    role="group"
                    aria-label="Период ЭПЛ"
                  >
                    <button
                      className={waybillMode === "week" ? "active" : ""}
                      onClick={() => setWaybillMode("week")}
                    >
                      Неделя
                    </button>
                    <button
                      className={waybillMode === "month" ? "active" : ""}
                      onClick={() => setWaybillMode("month")}
                    >
                      Месяц
                    </button>
                  </div>
                </div>
                {waybillMode === "week" ? (
                  <div className="dynamicsCards waybillCards eplWeeklyCards">
                    <article>
                      <small>Предыдущая неделя</small>
                      <strong>
                        {format(
                          (electronicWaybillWeekly.previous.systemSummary
                            .vehiclesWithMovement /
                            electronicWaybillWeekly.previous.systemSummary
                              .vehicles) *
                            100,
                          2,
                        )}
                        %
                      </strong>
                      <span>
                        {format(
                          electronicWaybillWeekly.previous.systemSummary
                            .vehiclesWithMovement,
                          0,
                        )}{" "}
                        из{" "}
                        {format(
                          electronicWaybillWeekly.previous.systemSummary
                            .vehicles,
                          0,
                        )}{" "}
                        ТС · {electronicWaybillWeekly.previous.period}
                      </span>
                    </article>
                    <article>
                      <small>Текущая неделя</small>
                      <strong>
                        {format(
                          (electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithMovement /
                            electronicWaybillWeekly.current.systemSummary
                              .vehicles) *
                            100,
                          2,
                        )}
                        %
                      </strong>
                      <span>
                        {format(
                          electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithMovement,
                          0,
                        )}{" "}
                        из{" "}
                        {format(
                          electronicWaybillWeekly.current.systemSummary
                            .vehicles,
                          0,
                        )}{" "}
                        ТС · {electronicWaybillWeekly.current.period}
                      </span>
                    </article>
                    <article className="positive">
                      <small>Изменение движения</small>
                      <strong>
                        ↑{" "}
                        {format(
                          (electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithMovement /
                            electronicWaybillWeekly.current.systemSummary
                              .vehicles) *
                            100 -
                            (electronicWaybillWeekly.previous.systemSummary
                              .vehiclesWithMovement /
                              electronicWaybillWeekly.previous.systemSummary
                                .vehicles) *
                              100,
                          2,
                        )}{" "}
                        п.п.
                      </strong>
                      <span>
                        +
                        {format(
                          electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithMovement -
                            electronicWaybillWeekly.previous.systemSummary
                              .vehiclesWithMovement,
                          0,
                        )}{" "}
                        ТС с движением
                      </span>
                    </article>
                    <article className="positive">
                      <small>ТС с путевыми листами</small>
                      <strong>
                        ↑{" "}
                        {format(
                          (electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithWaybills /
                            electronicWaybillWeekly.current.systemSummary
                              .vehicles) *
                            100 -
                            (electronicWaybillWeekly.previous.systemSummary
                              .vehiclesWithWaybills /
                              electronicWaybillWeekly.previous.systemSummary
                                .vehicles) *
                              100,
                          2,
                        )}{" "}
                        п.п.
                      </strong>
                      <span>
                        {format(
                          electronicWaybillWeekly.previous.systemSummary
                            .vehiclesWithWaybills,
                          0,
                        )}{" "}
                        →{" "}
                        {format(
                          electronicWaybillWeekly.current.systemSummary
                            .vehiclesWithWaybills,
                          0,
                        )}{" "}
                        ТС
                      </span>
                    </article>
                  </div>
                ) : (
                  <div className="dynamicsCards waybillCards">
                    <article>
                      <small>Организации в детализации</small>
                      <strong>
                        {format(electronicWaybill.detail.organizations, 0)}
                      </strong>
                      <span>единый сопоставимый перечень</span>
                    </article>
                    <article>
                      <small>Транспортные средства</small>
                      <strong>
                        {format(electronicWaybill.detail.vehicles, 0)}
                      </strong>
                      <span>сумма строк организаций</span>
                    </article>
                    <article className="positive">
                      <small>ТС с движением более 1 км</small>
                      <strong>
                        {format(
                          (electronicWaybill.detail.vehiclesWithMovement /
                            electronicWaybill.detail.vehicles) *
                            100,
                          2,
                        )}
                        %
                      </strong>
                      <span>
                        {format(
                          electronicWaybill.detail.vehiclesWithMovement,
                          0,
                        )}{" "}
                        из {format(electronicWaybill.detail.vehicles, 0)} ТС
                      </span>
                    </article>
                    <article className="negative">
                      <small>ТС без движения</small>
                      <strong>
                        {format(
                          electronicWaybill.detail.vehicles -
                            electronicWaybill.detail.vehiclesWithMovement,
                          0,
                        )}
                      </strong>
                      <span>требуют проверки использования</span>
                    </article>
                  </div>
                )}
              </section>
              <div className="waybillSecondaryStats">
                {waybillMode === "week" ? (
                  <>
                    <article>
                      <small>ТС без движения</small>
                      <strong>
                        {format(
                          electronicWaybillWeekly.current.systemSummary
                            .vehicles -
                            electronicWaybillWeekly.current.systemSummary
                              .vehiclesWithMovement,
                          0,
                        )}
                      </strong>
                      <span>по итоговой строке текущей недели</span>
                    </article>
                    <article>
                      <small>МО с движением</small>
                      <strong>
                        {format(
                          electronicWaybillWeekly.current.detail
                            .organizationsWithMovement,
                          0,
                        )}
                      </strong>
                      <span>
                        из{" "}
                        {format(
                          electronicWaybillWeekly.current.detail.organizations,
                          0,
                        )}{" "}
                        групп
                      </span>
                    </article>
                    <article>
                      <small>МО без движения</small>
                      <strong>
                        {format(
                          electronicWaybillWeekly.current.detail
                            .zeroMovementOrganizations,
                          0,
                        )}
                      </strong>
                      <span>при наличии транспорта</span>
                    </article>
                    <article>
                      <small>Создано путевых листов</small>
                      <strong>
                        {format(
                          electronicWaybillWeekly.current.detail.waybills,
                          0,
                        )}
                      </strong>
                      <span>текущая неделя · группы сопоставлены</span>
                    </article>
                  </>
                ) : (
                  <>
                    <article>
                      <small>МО с движением</small>
                      <strong>
                        {format(
                          electronicWaybill.rows.filter((r) => r.moved > 0)
                            .length,
                          0,
                        )}
                      </strong>
                      <span>
                        из {format(electronicWaybill.detail.organizations, 0)}{" "}
                        организаций
                      </span>
                    </article>
                    <article>
                      <small>МО без движения</small>
                      <strong>
                        {format(
                          electronicWaybill.detail.zeroMovementOrganizations,
                          0,
                        )}
                      </strong>
                      <span>при наличии транспорта</span>
                    </article>
                    <article>
                      <small>Создано путевых листов</small>
                      <strong>
                        {format(electronicWaybill.detail.waybills, 0)}
                      </strong>
                      <span>сумма детализации по организациям</span>
                    </article>
                    <article>
                      <small>Водители с путевыми листами</small>
                      <strong>
                        {format(
                          electronicWaybill.detail.driversWithWaybills,
                          0,
                        )}
                      </strong>
                      <span>сумма детализации по организациям</span>
                    </article>
                  </>
                )}
              </div>
              <section
                className="waybillZones"
                aria-label="Зоны использования ЭПЛ"
              >
                <div>
                  <b>Зоны использования</b>
                  <span>проектные пороги для управленческого контроля</span>
                </div>
                <button onClick={() => setWaybillStatus("stable")}>
                  <i className="zoneStable" />
                  <strong>{waybillZones.stable}</strong>
                  <span>устойчиво · ≥80%</span>
                </button>
                <button onClick={() => setWaybillStatus("partial")}>
                  <i className="zonePartial" />
                  <strong>{waybillZones.partial}</strong>
                  <span>частично · 30–79%</span>
                </button>
                <button onClick={() => setWaybillStatus("low")}>
                  <i className="zoneLow" />
                  <strong>{waybillZones.low}</strong>
                  <span>низко · 1–29%</span>
                </button>
                <button onClick={() => setWaybillStatus("noMovement")}>
                  <i className="zoneZero" />
                  <strong>{waybillZones.noMovement}</strong>
                  <span>нет движения · 0%</span>
                </button>
                <button onClick={() => setWaybillStatus("noFleet")}>
                  <i className="zoneNA" />
                  <strong>{waybillZones.noFleet}</strong>
                  <span>нет данных по ТС</span>
                </button>
              </section>
              <div className="meetingBlocks waybillRankings twoBlocks">
                <section className="rankingBlock movementLeaders">
                  <div className="rankingTitle">
                    <span>
                      <h3>Наибольшая активность</h3>
                      <small>наибольшее количество ТС с движением</small>
                    </span>
                    <b>10</b>
                  </div>
                  <div className="rankingRows">
                    {waybillLeaders.map((row, index) => (
                      <div key={row.name}>
                        <span className="miniRank">{index + 1}</span>
                        <p title={cleanMoName(row.name)}>
                          {cleanMoName(row.name)}
                        </p>
                        <b>{row.moved} движ.</b>
                        <strong>
                          {row.vehicles} ТС · {format(row.movementShare, 2)}%
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rankingBlock bad movementAttention">
                  <div className="rankingTitle">
                    <span>
                      <h3>Требуют внимания</h3>
                      <small>масштаб простоя и устойчивость проблемы</small>
                    </span>
                    <b>10</b>
                  </div>
                  <div className="rankingRows">
                    {waybillAttention.map((row, index) => {
                      const idle = row.vehicles - row.moved,
                        previous =
                          waybillMode === "week"
                            ? previousWaybillByNumber.get(row.sourceNumber)
                            : null,
                        persistent = Boolean(
                          previous && previous.moved === 0 && row.moved === 0,
                        );
                      return (
                        <div key={row.sourceNumber}>
                          <span className="miniRank">{index + 1}</span>
                          <p title={cleanMoName(row.name)}>
                            {cleanMoName(row.name)}
                            {persistent && <small>0% вторую неделю</small>}
                          </p>
                          <b>{idle} без движ.</b>
                          <strong>
                            {row.vehicles} ТС · {format(row.movementShare, 2)}%
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
              <section className="waybillSignals">
                <div className="waybillSignalsHead">
                  <div>
                    <p className="eyebrow">АВТОМАТИЧЕСКИЙ КОНТРОЛЬ</p>
                    <h2>Сигналы качества и использования</h2>
                  </div>
                  <span>
                    требуют проверки, но не являются ошибкой без подтверждения
                    МО
                  </span>
                </div>
                <div>
                  {waybillSignals.map((signal) => (
                    <article key={signal.label}>
                      <strong>{signal.rows.length}</strong>
                      <p>{signal.label}</p>
                      <small>
                        {signal.rows.length
                          ? signal.rows
                              .slice(0, 2)
                              .map((r) => cleanMoName(r.name))
                              .join(" · ")
                          : "расхождений не найдено"}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
              <div className="allMosHead">
                <div>
                  <p className="eyebrow">ДЕТАЛИЗАЦИЯ ПО ОРГАНИЗАЦИЯМ</p>
                  <h2>Все медицинские организации</h2>
                </div>
                <span>
                  {visibleWaybillRows.length} из {waybillRows.length}
                </span>
              </div>
              <div className="toolbar">
                <input
                  value={waybillQuery}
                  onChange={(e) => setWaybillQuery(e.target.value)}
                  placeholder="Найти медицинскую организацию"
                />
                <select
                  value={waybillStatus}
                  onChange={(e) => setWaybillStatus(e.target.value)}
                >
                  <option value="all">Все зоны</option>
                  <option value="stable">Устойчиво · ≥80%</option>
                  <option value="partial">Частично · 30–79%</option>
                  <option value="low">Низко · 1–29%</option>
                  <option value="noMovement">Нет движения · 0%</option>
                  <option value="noFleet">Нет данных по ТС</option>
                </select>
                <span className="sortHint">
                  Нажмите заголовок столбца для сортировки
                </span>
              </div>
              <div className="tableWrap">
                <table className="matrix waybillTable">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>
                        <button
                          className={waybillSortKey === "name" ? "sorted" : ""}
                          onClick={() => setWaybillSort("name")}
                        >
                          Организация / группа{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "name",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            waybillSortKey === "vehicles" ? "sorted" : ""
                          }
                          onClick={() => setWaybillSort("vehicles")}
                        >
                          ТС в системе{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "vehicles",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={waybillSortKey === "moved" ? "sorted" : ""}
                          onClick={() => setWaybillSort("moved")}
                        >
                          ТС с движением{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "moved",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            waybillSortKey === "movementShare" ? "sorted" : ""
                          }
                          onClick={() => setWaybillSort("movementShare")}
                        >
                          Доля движения{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "movementShare",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                  <th>
                    <button
                      className={waybillSortKey === "weekDelta" ? "sorted" : ""}
                      onClick={() => setWaybillSort("weekDelta")}
                    >
                      К предыдущей неделе{" "}
                      <i>{sortMark(waybillSortKey === "weekDelta", waybillSortDirection)}</i>
                    </button>
                  </th>
                      <th>
                        <button
                          className={
                            waybillSortKey === "waybills" ? "sorted" : ""
                          }
                          onClick={() => setWaybillSort("waybills")}
                        >
                          Путевые листы{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "waybills",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            waybillSortKey === "driversWithWaybills"
                              ? "sorted"
                              : ""
                          }
                          onClick={() => setWaybillSort("driversWithWaybills")}
                        >
                          Активные водители{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "driversWithWaybills",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>Пользователи</th>
                      <th>
                        <button
                          className={
                            waybillSortKey === "status" ? "sorted" : ""
                          }
                          onClick={() => setWaybillSort("status")}
                        >
                          Зона{" "}
                          <i>
                            {sortMark(
                              waybillSortKey === "status",
                              waybillSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWaybillRows.map((row, index) => {
                      const zone = waybillZone(row);
                      const driverShare =
                        row.drivers > 0
                          ? (row.driversWithWaybills / row.drivers) * 100
                          : null;
                      const previous =
                        waybillMode === "week"
                          ? previousWaybillByNumber.get(row.sourceNumber)
                          : null;
                      const movedDelta = previous
                        ? row.moved - previous.moved
                        : null;
                      const shareDelta =
                        previous &&
                        previous.movementShare !== null &&
                        row.movementShare !== null
                          ? row.movementShare - previous.movementShare
                          : null;
                      const direction = shareDelta ?? movedDelta;
                      const zoneLabel = {
                        stable: "Устойчиво",
                        partial: "Частично",
                        low: "Низко",
                        noMovement: "Нет движения",
                        noFleet: "Нет данных по ТС",
                      }[zone];
                      return (
                        <tr key={row.sourceNumber}>
                          <td>
                            <b className="rank">{index + 1}</b>
                          </td>
                          <td>
                            <strong>{cleanMoName(row.name)}</strong>
                            <small>
                              {row.ambulanceVehicles} автомобилей СМП ·{" "}
                              {row.otherVehicles} остальных ТС
                            </small>
                            {row.components && row.components.length > 1 && (
                              <details className="waybillComponents">
                                <summary>
                                  {row.components.length} строк источника —
                                  показать состав
                                </summary>
                                <div>
                                  {row.components.map((component) => (
                                    <span key={component.name}>
                                      <b>{cleanMoName(component.name)}</b>
                                      <i>
                                        {component.moved} из{" "}
                                        {component.vehicles} ТС ·{" "}
                                        {component.movementShare === null
                                          ? "—"
                                          : `${format(component.movementShare, 2)}%`}
                                      </i>
                                    </span>
                                  ))}
                                </div>
                              </details>
                            )}
                          </td>
                          <td>
                            <b>{format(row.vehicles, 0)}</b>
                          </td>
                          <td>
                            <b>{format(row.moved, 0)}</b>
                          </td>
                          <td>
                            <b
                              className={
                                zone === "noMovement"
                                  ? "badText"
                                  : zone === "stable"
                                    ? "green"
                                    : ""
                              }
                            >
                              {row.movementShare === null
                                ? "—"
                                : `${format(row.movementShare, 2)}%`}
                            </b>
                            <small>
                              {row.moved} из {row.vehicles}
                            </small>
                          </td>
                          <td>
                            {previous && direction !== null ? (
                              <>
                                <b
                                  className={
                                    direction > 0
                                      ? "deltaUp"
                                      : direction < 0
                                        ? "deltaDown"
                                        : ""
                                  }
                                >
                                  {direction > 0
                                    ? "↑"
                                    : direction < 0
                                      ? "↓"
                                      : "→"}{" "}
                                  {shareDelta === null
                                    ? `${format(Math.abs(movedDelta ?? 0), 0)} ТС`
                                    : `${format(Math.abs(shareDelta), 2)} п.п.`}
                                </b>
                                <small>
                                  {movedDelta === null
                                    ? ""
                                    : `${movedDelta > 0 ? "+" : ""}${format(movedDelta, 0)} ТС с движением`}
                                </small>
                              </>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td>
                            <b>{format(row.waybills, 0)}</b>
                            <small>
                              {row.ambulanceWaybills} СМП · {row.otherWaybills}{" "}
                              остальные
                            </small>
                          </td>
                          <td>
                            <b
                              className={
                                driverShare !== null && driverShare < 80
                                  ? "badText"
                                  : driverShare !== null && driverShare <= 100
                                    ? "green"
                                    : ""
                              }
                            >
                              {driverShare === null
                                ? "—"
                                : `${format(driverShare, 1)}%`}
                            </b>
                            <small>
                              {row.driversWithWaybills} из {row.drivers} ·
                              справочно
                            </small>
                          </td>
                          <td>
                            <span>{row.drivers} вод.</span>
                            <small>
                              {row.mechanics} мех. · {row.medics} мед.
                            </small>
                          </td>
                          <td>
                            <span
                              className={`statusChip ${zone === "stable" ? "good" : zone === "partial" ? "warn" : zone === "noFleet" ? "na" : "bad"}`}
                            >
                              {zoneLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="waybillDiagnosticNote">
                <b>Диагностический показатель:</b> доля активных водителей =
                водители, на которых открывались путевые листы ÷
                зарегистрированные водители. Он помогает выявлять неиспользуемые
                учётные записи, но не влияет на рейтинг: зарегистрированный
                водитель мог не выходить на линию в отчётном месяце.
              </p>

              <section className="eplRegulation">
                <div className="eplRegulationHead">
                  <div>
                    <p className="eyebrow">УТВЕРЖДЁННЫЙ РЕГЛАМЕНТ</p>
                    <h2>Контроль и действия медицинской организации</h2>
                    <p>
                      Единый цикл работы: подготовка к выпуску, контроль на
                      линии и закрытие путевого листа после смены
                    </p>
                  </div>
                  <span>выполняется постоянно</span>
                </div>
                <div className="eplCadence">
                  <article>
                    <b>Ежедневно</b>
                    <ul>
                      <li>Авторизация водителя перед выездом.</li>
                      <li>Предрейсовые медицинский и технический осмотры.</li>
                      <li>
                        Передача координат и контроль устройств без сигнала.
                      </li>
                      <li>Закрытие рейсов послерейсовыми отметками.</li>
                    </ul>
                  </article>
                  <article>
                    <b>Еженедельно</b>
                    <ul>
                      <li>
                        Актуальность пользователей и отключение уволенных.
                      </li>
                      <li>Полнота перечня транспортных средств.</li>
                      <li>Возврат мобильных устройств после смены.</li>
                      <li>Инциденты передачи доступов и NFC-меток.</li>
                    </ul>
                  </article>
                  <article>
                    <b>Ежемесячно</b>
                    <ul>
                      <li>Статистика рейсов и использование автопарка.</li>
                      <li>Нарушения выпуска транспорта на линию.</li>
                      <li>Потери спутникового сигнала.</li>
                      <li>Работа механиков и медицинских работников.</li>
                    </ul>
                  </article>
                </div>
                <div className="eplProcess">
                  <article>
                    <span>1</span>
                    <div>
                      <b>Инвентаризация</b>
                      <p>
                        Сверить пользователей, автопарк, открытые путевые листы,
                        телефоны, SIM-карты, оборудование и NFC-метки.
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>2</span>
                    <div>
                      <b>Административный контур</b>
                      <p>
                        Издать внутренний приказ, закрепить ответственных,
                        провести инструктаж и проверить доступы.
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>3</span>
                    <div>
                      <b>Штатный режим</b>
                      <p>
                        Перед сменой — осмотры и открытие листа; на линии —
                        мониторинг; после смены — осмотры и закрытие листа.
                      </p>
                    </div>
                  </article>
                </div>
                <div className="eplResponsibility">
                  <div>
                    <b>Руководитель МО</b>
                    <span>приказ и организация процесса</span>
                  </div>
                  <div>
                    <b>Ответственный представитель</b>
                    <span>пользователи, транспорт, устройства и данные</span>
                  </div>
                  <div>
                    <b>Механик</b>
                    <span>технический осмотр, выпуск и мониторинг</span>
                  </div>
                  <div>
                    <b>Медицинский работник</b>
                    <span>предрейсовый и послерейсовый медосмотр</span>
                  </div>
                  <div>
                    <b>Водитель</b>
                    <span>
                      авторизация, сигнал, сохранность и закрытие смены
                    </span>
                  </div>
                </div>
                <div className="eplDeadlines">
                  <div>
                    <small>Первичная настройка и подключение</small>
                    <b>5 дней</b>
                  </div>
                  <div>
                    <small>Предоставление доступа оператором</small>
                    <b>3 дня</b>
                  </div>
                  <div>
                    <small>Отключение при кадровых изменениях</small>
                    <b>3 дня</b>
                  </div>
                  <div className="eplSupport">
                    <small>Техническая поддержка</small>
                    <b>+7 (843) 202-00-94</b>
                    <span>epl.support@tatar.ru · пн–пт 06:00–18:00</span>
                  </div>
                </div>
              </section>

              <p className="prototypeNote">
                Региональная динамика сравнивает итоговые строки за 17–23.08 и
                24–30.08.2026. Детализация текущей недели включает дочерние
                строки без номера; динамика отдельных МО временно не
                рассчитывается до второго сопоставимого среза. В месячном режиме
                показан август 2026 года; сравнение — с июлем 2026 года.
              </p>
            </>
          )}

          {tab === "semd" && (
            <>
              <div className="pageHead semdHead">
                <div>
                  <p className="eyebrow">РЭМД · БЕЗ ДЕТАЛИЗАЦИИ ПО МО</p>
                  <h1>Все виды СЭМД</h1>
                  <p>
                    Количество документов по Республике Татарстан за период{" "}
                    {semdSummary.period}
                  </p>
                </div>
                <div className="asofPanel">
                  <small>Отчёт сформирован</small>
                  <strong>{semdSummary.formed}</strong>
                </div>
              </div>
              <div className="semdHero">
                <article>
                  <small>Всего зарегистрировано</small>
                  <strong>{format(semdSummary.total, 0)}</strong>
                  <span>СЭМД</span>
                </article>
                <article>
                  <small>Виды с регистрацией</small>
                  <strong>{semdSummary.registeredTypes}</strong>
                  <span>официальный итог исходника</span>
                </article>
                <article>
                  <small>Виды в справочнике отчёта</small>
                  <strong>{semdSummary.items.length}</strong>
                  <span>включая нулевые значения</span>
                </article>
              </div>
              <div className="semdToolbar">
                <input
                  value={semdQuery}
                  onChange={(e) => setSemdQuery(e.target.value)}
                  placeholder="Найти вид СЭМД"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={semdOnlyRegistered}
                    onChange={(e) => setSemdOnlyRegistered(e.target.checked)}
                  />{" "}
                  Только с зарегистрированными документами
                </label>
                <span>Показано: {visibleSemd.length}</span>
              </div>
              <div className="semdTableWrap">
                <table className="semdTable">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>
                        <button
                          className={semdSortKey === "name" ? "sorted" : ""}
                          onClick={() => setSemdSort("name")}
                        >
                          Вид СЭМД{" "}
                          <i>
                            {sortMark(
                              semdSortKey === "name",
                              semdSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={semdSortKey === "format" ? "sorted" : ""}
                          onClick={() => setSemdSort("format")}
                        >
                          Формат{" "}
                          <i>
                            {sortMark(
                              semdSortKey === "format",
                              semdSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={semdSortKey === "count" ? "sorted" : ""}
                          onClick={() => setSemdSort("count")}
                        >
                          Количество{" "}
                          <i>
                            {sortMark(
                              semdSortKey === "count",
                              semdSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                      <th>
                        <button
                          className={semdSortKey === "share" ? "sorted" : ""}
                          onClick={() => setSemdSort("share")}
                        >
                          Доля{" "}
                          <i>
                            {sortMark(
                              semdSortKey === "share",
                              semdSortDirection,
                            )}
                          </i>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSemd.map((item, index) => (
                      <tr key={item.name}>
                        <td>{index + 1}</td>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td>
                          <span>{item.format}</span>
                        </td>
                        <td>
                          <b>{format(item.count, 0)}</b>
                        </td>
                        <td>
                          <div className="shareCell">
                            <i
                              style={{
                                width: `${Math.max(item.count ? 2 : 0, (item.count / semdSummary.total) * 100)}%`,
                              }}
                            />
                            <span>
                              {format(
                                (item.count / semdSummary.total) * 100,
                                2,
                              )}
                              %
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="prototypeNote">
                Количество взято из строки «Республика Татарстан» отчёта РЭМД.
                Одноимённые CDA и PDF/A-1 объединены; переключатель позволяет
                показать также виды с нулевой регистрацией.
              </p>
            </>
          )}

          {tab === "matrix" && (
            <>
              {extendedReturn && (
                <button className="extendedBack" onClick={returnToExtended}>
                  ← Расширенная сводка · пункт {extendedReturn.point}
                </button>
              )}
              <div className="pageHead compactHead indicatorTitle">
                <h1>
                  {isMaxMetric
                    ? "ТМК и ЛВН посредством МАХ"
                    : selectedDataset.name}
                </h1>
                <div
                  className={`titlePlan ${isMaxMetric ? "neutral" : selectedDataset.plan === null ? "neutral" : statusFor(regionalFact, selectedDataset.plan, lowerIsBetter)}`}
                >
                  <small>
                    {isMaxMetric
                      ? "Месячный план"
                      : isCountMetric
                        ? "Период"
                        : "Плановый показатель"}
                  </small>
                  <strong>
                    {isMaxMetric
                      ? "10 000 в месяц"
                      : isCountMetric
                        ? (selectedDataset.period ?? selectedDataset.date)
                        : selectedDataset.plan === null
                          ? "не установлен"
                          : `${rtIndicator?.reverse ? "≤" : "≥"} ${format(selectedDataset.plan, 0)}%`}
                  </strong>
                  <span>
                    {isMaxMetric
                      ? `оперативный срез на ${selectedDataset.date}`
                      : `актуальность ${selectedDataset.date}`}
                  </span>
                </div>
              </div>
              {isMaxMetric && (
                <div className="maxMetricSwitch">
                  <button
                    className={matrixMetric === "tmkMaxCount" ? "active" : ""}
                    onClick={() => setMatrixMetric("tmkMaxCount")}
                  >
                    <span>Проведено ТМК</span>
                    <strong>{format(maxMetricTotals.tmk, 0)}</strong>
                  </button>
                  <button
                    className={matrixMetric === "elnMaxCount" ? "active" : ""}
                    onClick={() => setMatrixMetric("elnMaxCount")}
                  >
                    <span>Закрыто ЛВН после ТМК</span>
                    <strong>{format(maxMetricTotals.eln, 0)}</strong>
                  </button>
                  <p>
                    Один раздел: итог по РТ и детализация по МО переключаются
                    вместе.
                  </p>
                </div>
              )}
              <div className="mobileMetricSelect">
                <label htmlFor="mobile-metric">Показатель</label>
                <select
                  id="mobile-metric"
                  value={
                    matrixMetric === "elnMaxCount"
                      ? "tmkMaxCount"
                      : matrixMetric
                  }
                  onChange={(e) => setMatrixMetric(e.target.value)}
                >
                  {metricIds.map((id) => (
                    <option key={id} value={id}>
                      {metricDisplayName(id)}
                    </option>
                  ))}
                </select>
              </div>
              {selectedDataset.note && matrixMetric !== "semd228" && (
                <p className="sourceDataNote">
                  <b>Источник и ограничение:</b> {selectedDataset.note}
                </p>
              )}
              {preventiveTransition && (
                <section className="registrationErrors preventiveTransition">
                  <div className="registrationHead">
                    <div>
                      <p className="eyebrow">ПЕРЕХОДНАЯ ФОРМУЛА 2026 ГОДА</p>
                      <h2>MAX СЭМД 122/228 рассчитан отдельно по каждой МО</h2>
                      <p>
                        В расчёт включены взрослые и детские медицинские организации
                      </p>
                    </div>
                    <span>{preventiveSemdAudit.summary.organizations} сопоставленных МО</span>
                  </div>
                  <p className="dataWarning">
                    <b>Федеральная формула 2026 года:</b> MAX(СЭМД 122; СЭМД
                    228) по каждой МО ÷ обращения ФОМС с профилактической целью × 100%.
                    СЭМД не суммируются. Динамика к прежнему файлу не
                    подменяется месячным приростом: сравниваются накопительные срезы на 31.07 и 31.08.
                  </p>
                  <div className="errorSummary">
                    <div>
                      <strong>
                        {format(preventiveSemdAudit.summary.numerator ?? 0, 0)}
                      </strong>
                      <span>выбрано в числитель</span>
                    </div>
                    <div>
                      <strong>{format(preventiveSemdAudit.summary.denominator ?? 0, 0)}</strong>
                      <span>обращений ФОМС</span>
                    </div>
                    <div>
                      <strong>{preventiveSemdAudit.summary.selected122 ?? 0} / {preventiveSemdAudit.summary.selected228 ?? 0}</strong>
                      <span>выбран СЭМД 122 / 228</span>
                    </div>
                    <div>
                      <strong>{format(regionalFact, 2)}%</strong>
                      <span>факт РТ</span>
                    </div>
                  </div>
                  <p className="methodNote">
                    <b>Контроль качества:</b> одна частная строка из Ижевска со
                    знаменателем 1 не сопоставилась с отчётом РЭМД и исключена
                    из расчёта. Она сохранена в аудите, а не заменена нулём.
                  </p>
                </section>
              )}
              <section className="dynamicsPanel">
                <div className="dynamicsHead">
                  <div>
                    <b>Динамика показателя</b>
                    <span>
                      Неделя — оперативный контроль · месяцы — устойчивый
                      результат
                    </span>
                  </div>
                  <div className="dynamicsSwitch">
                    <button
                      className={dynamicsMode === "week" ? "active" : ""}
                      onClick={() => setDynamicsMode("week")}
                    >
                      Неделя
                    </button>
                    <button
                      className={dynamicsMode === "month" ? "active" : ""}
                      onClick={() => setDynamicsMode("month")}
                    >
                      Месяцы
                    </button>
                  </div>
                </div>
                {dynamicsMode === "week" ? (
                  <div className="dynamicsCards">
                    <article>
                      <small>Предыдущий срез</small>
                      <strong>
                        {regionalPrevious === null
                          ? "—"
                          : `${format(regionalPrevious, isCountMetric ? 0 : 2)}${isCountMetric ? "" : "%"}`}
                      </strong>
                      <span>{periods.previous}</span>
                    </article>
                    <article>
                      <small>Текущий срез</small>
                      <strong>
                        {format(regionalFact, isCountMetric ? 0 : 2)}
                        {isCountMetric ? "" : "%"}
                      </strong>
                      <span>{periods.current}</span>
                    </article>
                    <article
                      className={
                        regionalChange === null
                          ? "neutral"
                          : (
                                lowerIsBetter
                                  ? regionalChange < 0
                                  : regionalChange > 0
                              )
                            ? "positive"
                            : "negative"
                      }
                    >
                      <small>Изменение</small>
                      <strong>
                        {regionalChange === null
                          ? "—"
                          : `${regionalChange > 0 ? "↑" : regionalChange < 0 ? "↓" : "→"} ${format(Math.abs(regionalChange), isCountMetric ? 0 : 2)}${isCountMetric ? "" : " п.п."}`}
                      </strong>
                      <span>
                        {regionalChange === null
                          ? "нет сопоставимого среза"
                          : lowerIsBetter
                            ? "снижение — улучшение"
                            : "рост — улучшение"}
                      </span>
                    </article>
                    <article>
                      <small>
                        {rtIndicator?.quantity !== undefined
                          ? "Количество в текущем срезе"
                          : "Правило сравнения"}
                      </small>
                      <strong>
                        {rtIndicator?.quantity !== undefined
                          ? format(rtIndicator.quantity, 0)
                          : isCountMetric
                            ? "1 неделя"
                            : "с начала года"}
                      </strong>
                      <span>
                        {rtIndicator?.quantityLabel ??
                          "одинаковая продолжительность и состав МО"}
                      </span>
                    </article>
                  </div>
                ) : monthBenchmark ? (
                  <div className="dynamicsCards month">
                    <article>
                      <small>Предыдущий полный месяц</small>
                      <strong>
                        {format(
                          monthBenchmark.june,
                          monthBenchmark.unit === "count" ? 0 : 2,
                        )}
                        {monthBenchmark.unit === "%" ? "%" : ""}
                      </strong>
                      <span>
                        Июль 2026
                        {monthBenchmark.juneQuantity
                          ? ` · ${monthBenchmark.juneQuantity}`
                          : ""}
                      </span>
                    </article>
                    <article>
                      <small>Последний полный месяц</small>
                      <strong>
                        {format(
                          monthBenchmark.july,
                          monthBenchmark.unit === "count" ? 0 : 2,
                        )}
                        {monthBenchmark.unit === "%" ? "%" : ""}
                      </strong>
                      <span>
                        Август 2026
                        {monthBenchmark.julyQuantity
                          ? ` · ${monthBenchmark.julyQuantity}`
                          : ""}
                      </span>
                    </article>
                    <article
                      className={
                        (
                          lowerIsBetter
                            ? monthBenchmark.july < monthBenchmark.june
                            : monthBenchmark.july > monthBenchmark.june
                        )
                          ? "positive"
                          : "negative"
                      }
                    >
                          <small>Изменение: август к июлю</small>
                      <strong>
                        {monthBenchmark.july > monthBenchmark.june
                          ? "↑"
                          : monthBenchmark.july < monthBenchmark.june
                            ? "↓"
                            : "→"}{" "}
                        {format(
                          Math.abs(monthBenchmark.july - monthBenchmark.june),
                          monthBenchmark.unit === "count" ? 0 : 2,
                        )}
                        {monthBenchmark.unit === "%" ? " п.п." : ""}
                      </strong>
                      <span>
                        {monthBenchmark.unit === "count"
                          ? `${monthBenchmark.july >= monthBenchmark.june ? "+" : "−"}${format(Math.abs(monthBenchmark.july / monthBenchmark.june - 1) * 100, 1)}% к июлю`
                          : monthBenchmark.source}
                      </span>
                    </article>
                    <article className="preliminary">
                      <small>Сентябрь · оперативный срез</small>
                      <strong>
                        {format(regionalFact, isCountMetric ? 0 : 2)}
                        {isCountMetric ? "" : "%"}
                      </strong>
                      <span>
                        {isMaxMetric
                          ? `${format((regionalFact / Math.max(1, selectedDataset.plan ?? 1)) * 100, 1)}% годового плана · `
                          : ""}
                        на {selectedDataset.date} · в итог месяца не включён
                      </span>
                    </article>
                  </div>
                ) : (
                  <div className="monthEmpty">
                    <b>Нет двух полных месячных исходников</b>
                    <span>
                      Для этого показателя нет двух сопоставимых срезов на
                      31.07 и 31.08. Накопительный или сентябрьский оперативный
                      факт не подменяется месячным значением.
                    </span>
                  </div>
                )}
              </section>
              {dynamicsMode === "month" ? (
                monthlyDataset ? (
                  <MonthlyMoView
                    dataset={monthlyDataset}
                    plan={selectedDataset.plan}
                    lowerIsBetter={lowerIsBetter}
                    query={query}
                    setQuery={setQuery}
                    sortKey={moSortKey}
                    sortDirection={moSortDirection}
                    setSort={setMoSort}
                    selectedGuidance={selectedGuidance}
                    selectedMethodology={selectedMethodology}
                    ownership={moOwnership}
                    setOwnership={setMoOwnership}
                  />
                ) : (
                  <section className="monthlyNoDetail">
                    <b>Помесячной детализации по МО пока нет</b>
                    <span>
                      По этому показателю не загружены два сопоставимых полных
                      исходника за июль и август. Недельная таблица скрыта, чтобы
                      не смешивать разные периоды.
                    </span>
                  </section>
                )
              ) : (
                <>
                  {selectedUnitDataset ? (
                    <>
                      <UnitMoOverview dataset={selectedUnitDataset} />
                      {selectedGuidance && (
                        <ActionGuide guidance={selectedGuidance} />
                      )}
                      {selectedMethodology && (
                        <MethodologyGuide methodology={selectedMethodology} />
                      )}
                      <UnitDetail
                        dataset={selectedUnitDataset}
                        rows={visibleUnits}
                        query={unitQuery}
                        setQuery={setUnitQuery}
                        status={unitStatus}
                        setStatus={setUnitStatus}
                        sortKey={unitSortKey}
                        sortDirection={unitSortDirection}
                        setSort={setUnitSort}
                      />
                    </>
                  ) : (
                    <>
                      <div className="moStats five">
                        <article>
                          <small>
                            {isPresenceMetric
                              ? "МО в плановом перечне"
                              : "МО в исходнике"}
                          </small>
                          <strong>{indicatorRows.length}</strong>
                        </article>
                        {isCountMetric ? (
                          <>
                            {lowerIsBetter ? (
                              <>
                                <article>
                                  <small>Нулевой результат — лучше</small>
                                  <strong className="green">
                                    {
                                      indicatorRows.filter((r) => r.fact === 0)
                                        .length
                                    }
                                  </strong>
                                </article>
                                <article>
                                  <small>Есть случаи краткого ввода</small>
                                  <strong className="red">
                                    {
                                      indicatorRows.filter((r) => r.fact > 0)
                                        .length
                                    }
                                  </strong>
                                </article>
                              </>
                            ) : (
                              <>
                                <article>
                                  <small>С ненулевым результатом</small>
                                  <strong className="green">
                                    {
                                      indicatorRows.filter((r) => r.fact > 0)
                                        .length
                                    }
                                  </strong>
                                </article>
                                <article>
                                  <small>Нулевой результат</small>
                                  <strong className="red">
                                    {
                                      indicatorRows.filter((r) => r.fact === 0)
                                        .length
                                    }
                                  </strong>
                                </article>
                              </>
                            )}
                          </>
                        ) : isPresenceMetric ? (
                          <>
                            <article>
                              <small>Зарегистрировали СЭМД</small>
                              <strong className="green">{achievedMos}</strong>
                            </article>
                            <article>
                              <small>Не зарегистрировали ни одного</small>
                              <strong className="red">
                                {evaluableIndicatorRows.length - achievedMos}
                              </strong>
                            </article>
                          </>
                        ) : (
                          <>
                            <article>
                              <small>Выполнили план</small>
                              <strong className="green">{achievedMos}</strong>
                            </article>
                            <article>
                              <small>Не выполнили план</small>
                              <strong className="red">
                                {evaluableIndicatorRows.length - achievedMos}
                              </strong>
                            </article>
                          </>
                        )}
                        <article>
                          <small>
                            {isPresenceMetric
                              ? "СЭМД зарегистрированы"
                              : lowerIsBetter
                                ? "Снизили — хорошо"
                                : "Увеличили результат"}
                          </small>
                          <strong className="green">
                            {isPresenceMetric
                              ? indicatorRows.reduce(
                                  (sum, row) => sum + (row.count ?? 0),
                                  0,
                                )
                              : improvedMos}
                          </strong>
                        </article>
                        <article>
                          <small>
                            {isPresenceMetric
                              ? "Проверка перечня"
                              : lowerIsBetter
                                ? "Увеличили — плохо"
                                : "Снизили результат"}
                          </small>
                          <strong
                            className={isPresenceMetric ? "amber" : "red"}
                          >
                            {isPresenceMetric ? "OID" : worsenedMos}
                          </strong>
                        </article>
                      </div>
                      <div className="meetingBlocks">
                        <RankingBlock
                          metric={matrixMetric}
                          title={
                            isCountMetric
                              ? lowerIsBetter
                                ? "Лучший результат"
                                : "Наибольший объём"
                              : "Лидеры"
                          }
                          subtitle={
                            componentRanking
                              ? "выполнившие план — по объёму; остальные — по проценту"
                              : "10 медицинских организаций"
                          }
                          rows={displayedLeaders}
                          plan={selectedDataset.plan ?? 0}
                          tone="good"
                          countMode={isCountMetric}
                          lowerIsBetter={lowerIsBetter}
                          gapMode={componentRanking}
                        />
                        <RankingBlock
                          metric={matrixMetric}
                          title={
                            isCountMetric
                              ? lowerIsBetter
                                ? "Требуют внимания"
                                : "Наименьший объём"
                              : "Требуют внимания"
                          }
                          subtitle={
                            componentRanking
                              ? "по количеству, недостающему до плана"
                              : "10 медицинских организаций"
                          }
                          rows={laggards}
                          plan={selectedDataset.plan ?? 0}
                          tone="bad"
                          countMode={isCountMetric}
                          lowerIsBetter={lowerIsBetter}
                          gapMode={componentRanking}
                        />
                        <RankingBlock
                          metric={matrixMetric}
                          title={
                            lowerIsBetter
                              ? "Наибольший рост — ухудшение"
                              : "Наибольшее снижение"
                          }
                          subtitle={
                            isCountMetric
                              ? "к предыдущему срезу"
                              : `Срез на ${previousSnapshot} → срез на ${currentSnapshot}`
                          }
                          rows={deterioration}
                          plan={selectedDataset.plan ?? 0}
                          tone="warn"
                          showTrend
                          countMode={isCountMetric}
                          lowerIsBetter={lowerIsBetter}
                        />
                      </div>
                      {selectedGuidance && (
                        <ActionGuide guidance={selectedGuidance} />
                      )}
                      {selectedMethodology && (
                        <MethodologyGuide methodology={selectedMethodology} />
                      )}
                      <div className="allMosHead">
                        <div>
                          <p className="eyebrow">ДЕТАЛИЗАЦИЯ ПО ОРГАНИЗАЦИЯМ</p>
                          <h2>Все медицинские организации</h2>
                          <p>
                            Количество, факт, план и динамика — без
                            горизонтальной прокрутки
                          </p>
                        </div>
                        <span>{visibleOrgs.length} МО</span>
                      </div>
                      <div className="toolbar">
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Поиск медицинской организации"
                        />
                        <select
                          value={moOwnership}
                          onChange={(e) =>
                            setMoOwnership(e.target.value as "state" | "all")
                          }
                          aria-label="Форма собственности"
                        >
                          <option value="state">
                            Только государственные МО
                          </option>
                          <option value="all">Все МО, включая частные</option>
                        </select>
                        {!isCountMetric && (
                          <select
                            value={moStatus}
                            onChange={(e) => setMoStatus(e.target.value)}
                          >
                            <option value="all">Все статусы</option>
                            <option value="achieved">
                              {isPresenceMetric
                                ? "СЭМД зарегистрирован"
                                : "План выполнен"}
                            </option>
                            <option value="lag">
                              {isPresenceMetric
                                ? "Нет зарегистрированных СЭМД"
                                : "План не выполнен"}
                            </option>
                          </select>
                        )}
                        <span className="sortHint">
                          Нажмите заголовок столбца для сортировки
                        </span>
                      </div>
                      {!isCountMetric && !isPresenceMetric && (
                        <div className="legend">
                          <span>
                            <i className="dot good" />
                            план выполнен
                          </span>
                          <span>
                            <i className="dot warn" />
                            до плана менее 10%
                          </span>
                          <span>
                            <i className="dot bad" />
                            отставание более 10%
                          </span>
                        </div>
                      )}
                      <div className="tableWrap">
                        <table
                          className={`matrix indicatorTable ${isCountMetric || isPresenceMetric ? "countTable" : ""}`}
                        >
                          <thead>
                            <tr>
                              <th>№</th>
                              <th>
                                <button
                                  className={
                                    moSortKey === "name" ? "sorted" : ""
                                  }
                                  onClick={() => setMoSort("name")}
                                >
                                  Медицинская организация{" "}
                                  <i>
                                    {sortMark(
                                      moSortKey === "name",
                                      moSortDirection,
                                    )}
                                  </i>
                                </button>
                              </th>
                              {isCountMetric ? (
                                <>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "current" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("current")}
                                    >
                                      Текущий период{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "current",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "previous" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("previous")}
                                    >
                                      Предыдущий период{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "previous",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "trend" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("trend")}
                                    >
                                      Изменение{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "trend",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "trend" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("trend")}
                                    >
                                      Динамика{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "trend",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "status" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("status")}
                                    >
                                      Наличие данных{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "status",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                </>
                              ) : isPresenceMetric ? (
                                <>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "quantity" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("quantity")}
                                    >
                                      Количество СЭМД{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "quantity",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>OID МО</th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "status" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("status")}
                                    >
                                      Статус передачи{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "status",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                </>
                              ) : (
                                <>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "quantity" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("quantity")}
                                    >
                                      Количество
                                      <i>
                                        {sortMark(
                                          moSortKey === "quantity",
                                          moSortDirection,
                                        )}
                                      </i>
                                      <small>результат / объём</small>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "fact" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("fact")}
                                    >
                                      Факт / план{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "fact",
                                          moSortDirection,
                                        )}
                                      </i>
                                      <small>срез на {currentSnapshot}</small>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "deviation"
                                          ? "sorted"
                                          : ""
                                      }
                                      onClick={() => setMoSort("deviation")}
                                    >
                                      Отклонение{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "deviation",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "trend" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("trend")}
                                    >
                                      Динамика{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "trend",
                                          moSortDirection,
                                        )}
                                      </i>
                                      <small>
                                        к срезу на {previousSnapshot}
                                      </small>
                                    </button>
                                  </th>
                                  <th>
                                    <button
                                      className={
                                        moSortKey === "status" ? "sorted" : ""
                                      }
                                      onClick={() => setMoSort("status")}
                                    >
                                      Статус{" "}
                                      <i>
                                        {sortMark(
                                          moSortKey === "status",
                                          moSortDirection,
                                        )}
                                      </i>
                                    </button>
                                  </th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {visibleOrgs.map((o, idx) => {
                              const unavailable = isUnavailableSourceRow(o);
                              const plan = selectedDataset.plan ?? 0;
                              const deviation = o.fact - plan;
                              const s: Status = unavailable
                                ? "na"
                                : isCountMetric
                                  ? lowerIsBetter
                                    ? o.fact === 0
                                      ? "good"
                                      : "bad"
                                    : o.fact > 0
                                      ? "good"
                                      : "bad"
                                  : o.fact >= plan
                                    ? "good"
                                    : o.fact >= plan * 0.9
                                      ? "warn"
                                      : "bad";
                              const detail = getMoDetail(matrixMetric, o);
                              const trendGood =
                                o.trend !== null &&
                                (lowerIsBetter ? o.trend < 0 : o.trend > 0);
                              const trendBad =
                                o.trend !== null &&
                                (lowerIsBetter ? o.trend > 0 : o.trend < 0);
                              return (
                                <tr key={o.name}>
                                  <td>
                                    <b className="rank">{idx + 1}</b>
                                  </td>
                                  <td>
                                    <strong>
                                      {reportMoName(matrixMetric, o.name)}
                                    </strong>
                                    <small>
                                      {o.sourceWarning ??
                                        `данные на ${selectedDataset.date}`}
                                    </small>
                                  </td>
                                  {isCountMetric ? (
                                    <>
                                      <td>
                                        <b className="countValue">
                                          {format(o.fact, 0)}
                                        </b>
                                      </td>
                                      <td>
                                        <b className="countValue">
                                          {format(o.previous, 0)}
                                        </b>
                                      </td>
                                      <td
                                        className={
                                          trendBad
                                            ? "badText"
                                            : trendGood
                                              ? "green"
                                              : ""
                                        }
                                      >
                                        {o.trend === null
                                          ? "—"
                                          : `${o.trend > 0 ? "+" : ""}${format(o.trend, 0)}`}
                                      </td>
                                      <td>
                                        <span
                                          className={`trendPill ${trendBad ? "down" : trendGood ? "up" : ""}`}
                                        >
                                          {o.trend === null
                                            ? "нет сравнения"
                                            : `${o.trend > 0 ? "↑" : o.trend < 0 ? "↓" : "→"} ${format(Math.abs(o.trend), 0)}`}
                                        </span>
                                      </td>
                                      <td>
                                        <span className={`statusChip ${s}`}>
                                          {lowerIsBetter
                                            ? o.fact === 0
                                              ? "Лучший"
                                              : "Требует снижения"
                                            : o.fact > 0
                                              ? "Есть"
                                              : "Нет"}
                                        </span>
                                      </td>
                                    </>
                                  ) : isPresenceMetric ? (
                                    <>
                                      <td>
                                        <b className="countValue">
                                          {o.count === null ||
                                          o.count === undefined
                                            ? "есть"
                                            : format(o.count, 0)}
                                        </b>
                                      </td>
                                      <td>
                                        <span className="oidCell">
                                          {o.oid || "—"}
                                        </span>
                                      </td>
                                      <td>
                                        <span
                                          className={`statusChip ${o.fact > 0 ? "good" : "bad"}`}
                                        >
                                          {o.fact > 0
                                            ? "СЭМД зарегистрирован"
                                            : "Нет зарегистрированных СЭМД"}
                                        </span>
                                      </td>
                                    </>
                                  ) : unavailable ? (
                                    <>
                                      <td>
                                        <b className="countValue">—</b>
                                      </td>
                                      <td>
                                        <b>Нет данных</b>
                                        <small>
                                          исходная строка отсутствует
                                        </small>
                                      </td>
                                      <td>—</td>
                                      <td>—</td>
                                      <td>
                                        <span className="statusChip na">
                                          Нет данных
                                        </span>
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td>
                                        <b className="countValue">
                                          {detail
                                            ? `${format(detail.registered, 0)} / ${format(detail.volume, 0)}`
                                            : "—"}
                                        </b>
                                      </td>
                                      <td>
                                        <b>{format(o.fact)}%</b>
                                        <small>
                                          план {selectedDataset.plan}%
                                        </small>
                                      </td>
                                      <td
                                        className={
                                          deviation < 0 ? "badText" : "green"
                                        }
                                      >
                                        {deviation >= 0 ? "+" : ""}
                                        {format(deviation)} п.п.
                                      </td>
                                      <td>
                                        <span
                                          className={`trendPill ${(o.trend ?? 0) < 0 ? "down" : (o.trend ?? 0) > 0 ? "up" : ""}`}
                                        >
                                          {o.trend === null
                                            ? "—"
                                            : `${o.trend > 0 ? "↑" : o.trend < 0 ? "↓" : "→"} ${format(Math.abs(o.trend))} п.п.`}
                                        </span>
                                      </td>
                                      <td>
                                        <span className={`statusChip ${s}`}>
                                          {s === "good"
                                            ? "Выполнен"
                                            : s === "warn"
                                              ? "Риск"
                                              : "Отставание"}
                                        </span>
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="prototypeNote">
                        «Объём» — знаменатель показателя в актуальном исходнике;
                        «Результат» — количество событий, переданных или
                        зарегистрированных. Если исходник содержит только долю,
                        количественные поля отмечаются знаком «—».
                      </p>
                    </>
                  )}
                </>
              )}
              {matrixMetric === "death" && (
                <p className="periodComparisonNote">
                  <b>Почему количества различаются:</b> в режиме «Месяцы»
                  показан завершённый август 2026 года, а в режиме «Неделя»
                  — накопительный оперативный срез с 01.01 по 17.08.2026.
                  Поэтому числитель и знаменатель различаются; сравнивать их
                  напрямую нельзя.
                </p>
              )}
            </>
          )}

          {tab === "history" && (
            <>
              <div className="pageHead historyHead">
                <div>
                  <p className="eyebrow">ВЕРСИОННОСТЬ ДАШБОРДА</p>
                  <h1>История обновлений</h1>
                  <p>
                    Основные изменения данных, методики и интерфейса начиная с
                    версии 3.5.1
                  </p>
                </div>
                <div className="asofPanel">
                  <small>Текущая версия</small>
                  <strong>{DASHBOARD_VERSION}</strong>
                </div>
              </div>
              <div className="versionTimeline">
                {versionHistory.map((version, index) => (
                  <article
                    className={index === 0 ? "current" : ""}
                    key={version.version}
                  >
                    <div className="versionMarker">
                      <b>{version.version}</b>
                      <span>{version.date}</span>
                      {index === 0 && <i>Текущая</i>}
                    </div>
                    <ul>
                      {version.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
              <p className="prototypeNote">
                Первая цифра меняется при крупной перестройке дашборда, вторая —
                при существенном изменении методики или большом месячном выпуске
                данных, третья — при еженедельной загрузке, исправлениях и
                небольших изменениях интерфейса.
              </p>
            </>
          )}

          {(tab === "errors" || tab === "remdErrors") && (
            <>
              {tab === "errors" && <div className="pageHead errorHead">
                <div>
                  <p className="eyebrow">КОНТРОЛЬ МЕТОДИК И РАСЧЁТОВ</p>
                  <h1>Ошибки методик</h1>
                  <p>
                    Последняя проверка: 31.08.2026 · новые источники по
                    28–30.08.2026; каждый риск содержит временное правило и
                    требуемое уточнение
                  </p>
                </div>
                <div className="errorBadge">
                  <strong>{calcErrors.length}</strong>
                  <span>рисков и ошибок</span>
                </div>
              </div>}
              {tab === "remdErrors" && <>
              <div className="pageHead errorHead">
                <div>
                  <p className="eyebrow">КОНТРОЛЬ ФЕДЕРАЛЬНОЙ РЕГИСТРАЦИИ</p>
                  <h1>Ошибки РЭМД</h1>
                  <p>
                    Отказы регистрации СЭМД в разрезе категорий и медицинских
                    организаций
                  </p>
                </div>
                <div className="errorBadge">
                  <strong>{format(errorCategories.total, 0)}</strong>
                  <span>отказов регистрации</span>
                </div>
              </div>
              <div className="registrationErrors">
                <div className="registrationHead">
                  <div>
                    <p className="eyebrow">ОТКАЗЫ ФЕДЕРАЛЬНОЙ РЕГИСТРАЦИИ</p>
                    <h2>Категории ошибок регистрации СЭМД</h2>
                    <p>
                      {errorCategories.period} · всего{" "}
                      {format(errorCategories.total, 0)} ошибок
                    </p>
                  </div>
                  <span>{errorCategories.items.length} категории</span>
                </div>

                <div className="errorViewTabs" role="tablist" aria-label="Разрез ошибок регистрации">
                  <button
                    type="button"
                    className={errorView === "categories" ? "active" : ""}
                    onClick={() => setErrorView("categories")}
                  >
                    По категориям
                  </button>
                  <button
                    type="button"
                    className={errorView === "organizations" ? "active" : ""}
                    onClick={() => setErrorView("organizations")}
                  >
                    По медицинским организациям
                  </button>
                </div>

                {errorBreakdown ? (
                  <div className="errorMoSummary">
                    <div>
                      <span>Отнесено к медицинским организациям</span>
                      <strong>{format(errorBreakdown.attributedErrors, 0)}</strong>
                    </div>
                    <div>
                      <span>Медицинская организация не определена</span>
                      <strong>{format(errorBreakdown.unassignedErrors, 0)}</strong>
                    </div>
                    <div>
                      <span>Полнота привязки</span>
                      <strong>{format(errorBreakdown.coveragePercent, 2)}%</strong>
                    </div>
                    <div>
                      <span>Медицинских организаций в источнике</span>
                      <strong>{format(errorBreakdown.organizationCount, 0)}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="errorMoUnavailable">
                    <b>Разрез по медицинским организациям ещё не заполнен для текущего среза.</b>{" "}
                    Текущая агрегация по категориям сохранена без изменений. После повторной
                    обработки исходного файла «Отказы по регистрации ЭМД в РЭМД» здесь
                    автоматически появятся медицинские организации, структура их ошибок и контроль полноты привязки.
                  </p>
                )}

                {errorView === "categories" ? (
                  <>
                    <div className="errorListLegend">
                      <span>Категория</span>
                      <span>Количество</span>
                      <span>Структура</span>
                    </div>
                    <div className="errorCategoryList">
                      {errorCategories.items.map((e, idx) => (
                        <button
                          type="button"
                          className={selectedErrorCategory === e.name ? "selected" : ""}
                          key={e.name}
                          onClick={() =>
                            setSelectedErrorCategory((current) =>
                              current === e.name ? null : e.name,
                            )
                          }
                        >
                          <b>{idx + 1}</b>
                          <p>{e.name}</p>
                          <strong>{format(e.count, 0)}</strong>
                          <span title="Удельный вес категории в общем массиве ошибок, не показатель качества МО">
                            {format((e.count / errorCategories.total) * 100, 2)}%
                          </span>
                          <i
                            style={{
                              width: `${(e.count / errorCategories.items[0].count) * 100}%`,
                            }}
                          />
                        </button>
                      ))}
                    </div>

                    {selectedErrorCategory && errorBreakdown && (
                      <div className="errorDrilldown">
                        <div className="errorDrilldownHead">
                          <div>
                            <p className="eyebrow">ВЫБРАННАЯ КАТЕГОРИЯ</p>
                            <h3>{selectedErrorCategory}</h3>
                          </div>
                          <span>{selectedCategoryOrganizations.length} медицинских организаций</span>
                        </div>
                        <p className="errorDrilldownHint">
                          Медицинские организации, сформировавшие эту ошибку. Показано
                          абсолютное количество ошибок, без оценки качества медицинской организации.
                        </p>
                        <div className="errorMoRows compact">
                          {selectedCategoryOrganizations.map((item) => (
                            <button
                              type="button"
                              key={item.key}
                              onClick={() => {
                                setSelectedErrorOrganization(item.key);
                                setErrorView("organizations");
                              }}
                            >
                              <div>
                                <strong>{item.name}</strong>
                                {item.oid && <small>OID {item.oid}</small>}
                              </div>
                              <b>{format(item.count, 0)}</b>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : errorBreakdown ? (
                  <div className="errorMoWorkspace">
                    <div className="errorMoDirectory">
                      <div className="errorMoSearch">
                        <input
                          value={errorOrganizationQuery}
                          onChange={(event) => setErrorOrganizationQuery(event.target.value)}
                          placeholder="Поиск медицинской организации или OID"
                          aria-label="Поиск медицинской организации"
                        />
                        <span>{filteredErrorOrganizations.length} медицинских организаций</span>
                      </div>
                      <div className="errorMoRows">
                        {filteredErrorOrganizations.map((item) => (
                          <button
                            type="button"
                            key={item.key}
                            className={selectedErrorOrganization === item.key ? "selected" : ""}
                            onClick={() => setSelectedErrorOrganization(item.key)}
                          >
                            <div>
                              <strong>{item.name}</strong>
                              {item.oid && <small>OID {item.oid}</small>}
                              <p>
                                {item.topCategories.length
                                  ? item.topCategories
                                      .map(
                                        (category) =>
                                          `${category.name} — ${format(category.count, 0)}`,
                                      )
                                      .join(" · ")
                                  : "Категории не определены"}
                              </p>
                            </div>
                            <b>{format(item.count, 0)}</b>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="errorMoDetail">
                      {activeErrorOrganization ? (
                        <>
                          <div className="errorDrilldownHead">
                            <div>
                              <p className="eyebrow">СТРУКТУРА ОШИБОК МЕДИЦИНСКОЙ ОРГАНИЗАЦИИ</p>
                              <h3>{activeErrorOrganization.name}</h3>
                              {activeErrorOrganization.oid && (
                                <small>OID {activeErrorOrganization.oid}</small>
                              )}
                            </div>
                            <span>{format(activeErrorOrganization.count, 0)} ошибок</span>
                          </div>
                          <p className="errorDrilldownHint">
                            Это структура абсолютного количества ошибок данной медицинской организации. Она не
                            является «долей ошибок» или рейтингом качества: знаменатель всех
                            обработанных запросов по медицинской организации отсутствует.
                          </p>
                          <div className="errorMoCategories">
                            {activeErrorOrganization.categories.map((category, idx) => (
                              <div key={category.name}>
                                <b>{idx + 1}</b>
                                <p>{category.name}</p>
                                <strong>{format(category.count, 0)}</strong>
                                <span>
                                  {format(
                                    (category.count / activeErrorOrganization.count) * 100,
                                    2,
                                  )}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="errorMoEmpty">
                          <strong>Выберите медицинскую организацию</strong>
                          <p>Справа появится полная структура её ошибок регистрации СЭМД.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="errorMoEmpty standalone">
                    <strong>Разрез по медицинским организациям не заполнен для текущего среза</strong>
                    <p>
                      Нужна повторная обработка исходной выгрузки. Категории и общий итог
                      текущего дашборда при этом не изменяются.
                    </p>
                  </div>
                )}

                <p className="dataWarning">
                  <b>Важно:</b> процент рядом с категорией показывает только её удельный вес
                  в массиве отказов. Это не федеральная «доля ошибок» и не рейтинг качества
                  медицинской организации. Федеральная доля не пересчитывается: в текущей
                  выгрузке отсутствует знаменатель всех обработанных запросов.
                </p>
              </div>
              </>}
              {tab === "errors" && <>
              <div className="errorSummary">
                <div>
                  <strong>
                    {calcErrors.filter((e) => e.severity === "critical").length}
                  </strong>
                  <span>критические</span>
                </div>
                <div>
                  <strong>
                    {calcErrors.filter((e) => e.severity === "high").length}
                  </strong>
                  <span>высокий риск</span>
                </div>
                <div>
                  <strong>
                    {calcErrors.filter((e) => e.severity === "medium").length}
                  </strong>
                  <span>методические</span>
                </div>
                <div>
                  <strong>
                    {calcErrors.filter((e) => e.status === "Исправлена").length}
                  </strong>
                  <span>исправлены</span>
                </div>
              </div>
              <div className="errorList">
                {calcErrors.map((e, idx) => (
                  <article key={e.issue}>
                    <div className={`sev ${e.severity}`}>
                      <span>{String(idx + 1).padStart(2, "0")}</span>
                      <b>
                        {e.severity === "critical"
                          ? "Критично"
                          : e.severity === "high"
                            ? "Высокий риск"
                            : "Методика"}
                      </b>
                    </div>
                    <div className="errorBody">
                      <small>{e.source}</small>
                      <span
                        className={`auditStatus ${e.status?.startsWith("Исправлена") ? "fixed" : "pending"}`}
                      >
                        {e.status ?? "Требует уточнения"}
                      </span>
                      <h3>{e.issue}</h3>
                      <p>
                        <b>Влияние:</b> {e.impact}
                      </p>
                      <p className="fix">
                        <b>Как исправляем:</b> {e.fix}
                      </p>
                      {"temporary" in e && e.temporary && (
                        <p>
                          <b>Временное правило:</b> {e.temporary}
                        </p>
                      )}
                      {"needed" in e && e.needed && (
                        <p>
                          <b>Что требуется:</b> {e.needed}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              </>}
            </>
          )}

          {tab === "methods" && (
            <>
              <div className="pageHead methodsHead">
                <div>
                  <p className="eyebrow">ЕДИНЫЙ СПРАВОЧНИК</p>
                  <h1>Методики расчёта показателей</h1>
                  <p>
                    Формулы федеральных показателей приведены по методическим
                    рекомендациям от 10.07.2026; региональные абсолютные
                    показатели отмечены отдельно.
                  </p>
                </div>
                <div className="methodBadge">
                  <strong>{methodologies.length}</strong>
                  <span>методик</span>
                </div>
              </div>
              <div className="methodsToolbar">
                <input
                  value={methodQuery}
                  onChange={(e) => setMethodQuery(e.target.value)}
                  placeholder="Найти показатель или источник"
                />
                <span>
                  Показано:{" "}
                  {
                    methodologies.filter((m) =>
                      (m.name + " " + m.source)
                        .toLowerCase()
                        .includes(methodQuery.toLowerCase()),
                    ).length
                  }
                </span>
              </div>
              <div className="methodsGrid">
                {methodologies
                  .filter((m) =>
                    (m.name + " " + m.source)
                      .toLowerCase()
                      .includes(methodQuery.toLowerCase()),
                  )
                  .map((m, index) => (
                    <details className="methodCard" key={m.id} open>
                      <summary>
                        <span>
                          <b>{String(index + 1).padStart(2, "0")}</b>
                          <strong>{m.name}</strong>
                        </span>
                        <i>⌄</i>
                      </summary>
                      <div className="methodBody">
                        <div className="methodFormula">
                          <small>Формула</small>
                          <strong>{m.formula}</strong>
                        </div>
                        <div className="methodParts">
                          <article>
                            <small>Числитель / учитываемое значение</small>
                            <p>{m.numerator}</p>
                          </article>
                          <article>
                            <small>Знаменатель</small>
                            <p>{m.denominator}</p>
                          </article>
                          <article>
                            <small>Источник</small>
                            <p>{m.source}</p>
                          </article>
                          <article>
                            <small>Периодичность расчёта</small>
                            <p>{m.cadence}</p>
                          </article>
                        </div>
                        {m.note && (
                          <p className="methodNote">
                            <b>Важные условия:</b> {m.note}
                          </p>
                        )}
                        {m.legal && (
                          <p className="methodNote">
                            <b>Нормативное основание:</b> {m.legal}
                          </p>
                        )}
                        {vitacoreInstructions[m.id] && (
                          <div className="vitacoreGuide">
                            <div className="vitacoreGuideHead">
                              <b>Как сформировать СЭМД в МИС Витакор</b>
                              <span>практический маршрут для медицинской организации</span>
                            </div>
                            <div className="methodParts">
                              <article><small>Исходная учетная форма</small><p>{vitacoreInstructions[m.id].form}</p></article>
                              <article><small>Где находится</small><p>{vitacoreInstructions[m.id].path}</p></article>
                              <article><small>Действие врача</small><p>{vitacoreInstructions[m.id].action}</p></article>
                              <article><small>Результат и контроль</small><p>{vitacoreInstructions[m.id].result} {vitacoreInstructions[m.id].control}</p></article>
                            </div>
                            {vitacoreInstructions[m.id].source && (
                              <a href={vitacoreInstructions[m.id].source} target="_blank" rel="noreferrer">Открыть инструкцию Витакора ↗</a>
                            )}
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
              </div>
              <p className="prototypeNote">
                Если состав плановых медицинских организаций или подразделений
                изменился в ФРМО, числитель и знаменатель должны пересчитываться
                на одну и ту же дату. Недельные, месячные и накопительные
                значения не смешиваются.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function PreventiveAuditTable({
  title,
  rows,
}: {
  title: string;
  rows: PreventiveAuditRow[];
}) {
  return (
    <details className="methodCard preventiveAudit" open>
      <summary>
        <span>
          <b>{rows.length}</b>
          <strong>{title}</strong>
        </span>
        <i>⌄</i>
      </summary>
      <div className="tableWrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Медицинская организация</th>
              <th>СЭМД 228</th>
              <th>Случаи ФОМС</th>
              <th>Доля только по 228</th>
              <th>Статус оценки</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.oid}-${row.name}`}>
                <td>
                  <strong>{cleanMoName(row.name)}</strong>
                </td>
                <td>
                  <b>
                    {row.semd228 === null
                      ? "Нет данных"
                      : format(row.semd228, 0)}
                  </b>
                </td>
                <td>
                  <b>
                    {row.foms === null ? "Нет данных" : format(row.foms, 0)}
                  </b>
                </td>
                <td>
                  <b>
                    {row.oldShare === null
                      ? "—"
                      : `${format(row.oldShare, 2)}%`}
                  </b>
                </td>
                <td>
                  <span className="statusChip na">Ожидается СЭМД 122</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function UnitMoOverview({ dataset }: { dataset: UnitDataset }) {
  const [openMo, setOpenMo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<
    "mo" | "fact" | "share" | "problems" | "status"
  >("share");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        mo: string;
        oid: string;
        plan: number;
        fact: number;
        rows: UnitRow[];
      }
    >();
    dataset.rows.forEach((row) => {
      const key = row.moOid || row.mo;
      const item = map.get(key) ?? {
        key,
        mo: row.mo,
        oid: row.moOid,
        plan: 0,
        fact: 0,
        rows: [],
      };
      const planned = row.plannedSubunits ?? 1;
      const registered =
        row.registeredSubunits ??
        (row.registered && !row.partial
          ? planned
          : row.registered
            ? Math.max(1, planned - 1)
            : 0);
      item.plan += planned;
      item.fact += Math.min(registered, planned);
      item.rows.push(row);
      map.set(key, item);
    });
    return [...map.values()].map((item) => ({
      ...item,
      share: item.plan ? (item.fact / item.plan) * 100 : 0,
      problems: item.plan - item.fact,
      status: (item.fact === item.plan
        ? "good"
        : item.fact === 0
          ? "bad"
          : "warn") as Status,
    }));
  }, [dataset]);
  const setSort = (key: typeof sortKey) => {
    if (sortKey === key)
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection(key === "mo" ? "asc" : "desc");
    }
  };
  const mark = (key: typeof sortKey) =>
    sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const visible = groups
    .filter((g) =>
      cleanMoName(g.mo).toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const values = {
        mo: [cleanMoName(a.mo), cleanMoName(b.mo)],
        fact: [a.fact, b.fact],
        share: [a.share, b.share],
        problems: [a.problems, b.problems],
        status: [a.status, b.status],
      }[sortKey];
      const comparison =
        typeof values[0] === "string"
          ? String(values[0]).localeCompare(String(values[1]), "ru")
          : Number(values[0]) - Number(values[1]);
      return (
        (sortDirection === "asc" ? comparison : -comparison) ||
        cleanMoName(a.mo).localeCompare(cleanMoName(b.mo), "ru")
      );
    });
  const good = groups.filter((g) => g.status === "good").length,
    partial = groups.filter((g) => g.status === "warn").length,
    none = groups.filter((g) => g.status === "bad").length;
  const leaders = [...groups]
    .sort((a, b) => b.share - a.share || b.plan - a.plan)
    .slice(0, 10);
  const attention = [...groups]
    .filter((g) => g.problems > 0)
    .sort((a, b) => b.problems - a.problems || a.share - b.share)
    .slice(0, 10);
  const entity =
    dataset.entity.includes("КДЛ") ||
    dataset.entity.toLowerCase().includes("лаборатор")
      ? "КДЛ"
      : dataset.entity.includes("СМП")
        ? "станции/подстанции СМП"
        : "ТВСП";
  return (
    <section className="unitMoOverview">
      <div className="allMosHead">
        <div>
          <p className="eyebrow">ПЕРВЫЙ УРОВЕНЬ · УПРАВЛЕНЧЕСКИЙ</p>
          <h2>Сводно по медицинским организациям</h2>
          <p>
            Статус МО определяется по всем обязательным {entity}: один
            проблемный объект переводит МО в статус «Частично»
          </p>
        </div>
        <span>{groups.length} МО</span>
      </div>
      <p className="unitMoMethodNote">
        Региональная доля выше рассчитана по федеральной методике на уровне
        объектов. Управленческий статус ниже — по всем обязательным
        подразделениям, поэтому суммы двух уровней могут различаться.
      </p>
      <div className="unitMoStats">
        <article>
          <small>МО участвуют</small>
          <strong>{groups.length}</strong>
        </article>
        <article>
          <small>Все объекты передают</small>
          <strong className="green">{good}</strong>
        </article>
        <article>
          <small>Передают частично</small>
          <strong className="amber">{partial}</strong>
        </article>
        <article>
          <small>Не передаёт ни один</small>
          <strong className="red">{none}</strong>
        </article>
        <article>
          <small>МО с проблемами</small>
          <strong className="red">{partial + none}</strong>
        </article>
      </div>
      <div className="unitMoPanels">
        <article className="unitMoPanel good">
          <header>
            <div>
              <h3>Лидеры</h3>
              <span>сначала 100%, затем больший плановый объём</span>
            </div>
            <b>{leaders.length}</b>
          </header>
          {leaders.map((g, i) => (
            <div className="unitMoRank" key={g.key}>
              <i>{i + 1}</i>
              <span>
                {cleanMoName(g.mo)}
                <small>
                  {format(g.fact, 0)} из {format(g.plan, 0)} {entity}
                </small>
              </span>
              <strong>{format(g.share, 2)}%</strong>
            </div>
          ))}
        </article>
        <article className="unitMoPanel bad">
          <header>
            <div>
              <h3>Требуют внимания</h3>
              <span>по количеству непередающих объектов</span>
            </div>
            <b>{attention.length}</b>
          </header>
          {attention.length ? (
            attention.map((g, i) => (
              <div className="unitMoRank" key={g.key}>
                <i>{i + 1}</i>
                <span>
                  {cleanMoName(g.mo)}
                  <small>
                    {format(g.fact, 0)} из {format(g.plan, 0)} {entity}
                  </small>
                </span>
                <strong>{g.problems} не перед.</strong>
              </div>
            ))
          ) : (
            <p className="emptyRanking">Проблемных МО нет</p>
          )}
        </article>
      </div>
      <div className="allMosHead unitMoTableHead">
        <div>
          <p className="eyebrow">ВСЕ МЕДИЦИНСКИЕ ОРГАНИЗАЦИИ</p>
          <h2>Контроль полноты передачи</h2>
          <p>Нажмите на МО, чтобы увидеть только её проблемные подразделения</p>
        </div>
        <span>{visible.length} МО</span>
      </div>
      <div className="toolbar unitMoToolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск медицинской организации"
        />
        <span className="sortHint">
          Нажмите заголовок столбца для сортировки
        </span>
      </div>
      <div className="tableWrap">
        <table className="matrix unitMoTable">
          <thead>
            <tr>
              <th>№</th>
              <th>
                <button
                  className={sortKey === "mo" ? "sorted" : ""}
                  onClick={() => setSort("mo")}
                >
                  Медицинская организация <i>{mark("mo")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "fact" ? "sorted" : ""}
                  onClick={() => setSort("fact")}
                >
                  Передают / план <i>{mark("fact")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "share" ? "sorted" : ""}
                  onClick={() => setSort("share")}
                >
                  Доля <i>{mark("share")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "problems" ? "sorted" : ""}
                  onClick={() => setSort("problems")}
                >
                  Не передают <i>{mark("problems")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "status" ? "sorted" : ""}
                  onClick={() => setSort("status")}
                >
                  Статус <i>{mark("status")}</i>
                </button>
              </th>
            </tr>
          </thead>
          {visible.map((g, index) => {
            const opened = openMo === g.key;
            const problemRows = g.rows.filter(
              (r) =>
                !r.registered ||
                r.partial ||
                (r.registeredSubunits ?? r.plannedSubunits) !==
                  r.plannedSubunits,
            );
            return (
              <tbody key={g.key} className="unitMoGroup">
                <tr className="unitMoMainRow">
                  <td>
                    <b className="rank">{index + 1}</b>
                  </td>
                  <td>
                    <button
                      className="unitMoOpen"
                      onClick={() => setOpenMo(opened ? null : g.key)}
                    >
                      <span>{opened ? "▾" : "▸"}</span>
                      <strong>{cleanMoName(g.mo)}</strong>
                      <small>{g.oid || "OID не указан"}</small>
                    </button>
                  </td>
                  <td>
                    <b>
                      {format(g.fact, 0)} / {format(g.plan, 0)}
                    </b>
                  </td>
                  <td>
                    <b>{format(g.share, 2)}%</b>
                  </td>
                  <td className={g.problems ? "badText" : "green"}>
                    <b>{g.problems}</b>
                  </td>
                  <td>
                    <span className={`statusChip ${g.status}`}>
                      {g.status === "good"
                        ? "Выполнено"
                        : g.status === "warn"
                          ? "Частично"
                          : "Не выполнено"}
                    </span>
                  </td>
                </tr>
                {opened && (
                  <tr className="unitMoIssues">
                    <td colSpan={6}>
                      {problemRows.length ? (
                        <div>
                          <b>Проблемные {entity}</b>
                          {problemRows.map((r, i) => (
                            <article key={`${r.buildingIds}-${r.unitOid}-${i}`}>
                              <span>{r.unit}</span>
                              <small>
                                {r.unitOid ||
                                  r.buildingIds ||
                                  "идентификатор не указан"}
                              </small>
                              <strong>
                                {r.registeredSubunits !== undefined
                                  ? `${r.registeredSubunits} из ${r.plannedSubunits}`
                                  : "не передаёт"}
                              </strong>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p>Все обязательные объекты передают документ.</p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}

function UnitDetail({
  dataset,
  rows,
  query,
  setQuery,
  status,
  setStatus,
  sortKey,
  sortDirection,
  setSort,
}: {
  dataset: UnitDataset;
  rows: UnitRow[];
  query: string;
  setQuery: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  sortKey: "mo" | "unit" | "count" | "status";
  sortDirection: SortDirection;
  setSort: (k: "mo" | "unit" | "count" | "status") => void;
}) {
  const mark = (key: typeof sortKey) =>
    sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  return (
    <section className="unitDetail">
      <div className="unitDetailHead">
        <div>
          <p className="eyebrow">ВТОРОЙ УРОВЕНЬ · ТЕХНИЧЕСКИЙ</p>
          <h2>Детализация по подразделениям и объектам</h2>
          <p>{dataset.name} · поиск по подразделению, объекту или OID</p>
        </div>
        <span>{dataset.entity}</span>
      </div>
      <div className="unitStats">
        <article>
          <small>В плановом перечне</small>
          <strong>{dataset.plan}</strong>
        </article>
        <article>
          <small>Обеспечили передачу</small>
          <strong className="green">{dataset.fact}</strong>
        </article>
        <article>
          <small>Не передают</small>
          <strong className="red">{dataset.plan - dataset.fact}</strong>
        </article>
        <article>
          <small>Доля</small>
          <strong>{format((dataset.fact / dataset.plan) * 100, 2)}%</strong>
        </article>
      </div>
      <div className="toolbar unitToolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск МО, подразделения или OID"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Все объекты</option>
          <option value="yes">Передают</option>
          <option value="no">Не передают</option>
        </select>
        <span className="sortHint">Найдено: {rows.length}</span>
      </div>
      <div className="tableWrap">
        <table className="matrix unitTable">
          <thead>
            <tr>
              <th>№</th>
              <th>
                <button
                  className={sortKey === "mo" ? "sorted" : ""}
                  onClick={() => setSort("mo")}
                >
                  Медицинская организация <i>{mark("mo")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "unit" ? "sorted" : ""}
                  onClick={() => setSort("unit")}
                >
                  Подразделение / объект <i>{mark("unit")}</i>
                </button>
              </th>
              <th>Идентификаторы</th>
              <th>
                <button
                  className={sortKey === "count" ? "sorted" : ""}
                  onClick={() => setSort("count")}
                >
                  СЭМД <i>{mark("count")}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "status" ? "sorted" : ""}
                  onClick={() => setSort("status")}
                >
                  Статус <i>{mark("status")}</i>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.moOid}-${row.buildingIds}-${row.unitOid}`}>
                <td>
                  <b className="rank">{index + 1}</b>
                </td>
                <td>
                  <strong>{cleanMoName(row.mo)}</strong>
                  <small>{row.moOid}</small>
                </td>
                <td>
                  <strong>{row.unit}</strong>
                  {row.plannedSubunits !== undefined && (
                    <small>
                      передают СП: {row.registeredSubunits} из{" "}
                      {row.plannedSubunits}
                    </small>
                  )}
                </td>
                <td>
                  <span className="oidCell">
                    ID здания: {row.buildingIds || "—"}
                  </span>
                  <small className="oidList">
                    OID СП: {row.unitOid || "—"}
                  </small>
                </td>
                <td>
                  <b className="countValue">{format(row.count, 0)}</b>
                </td>
                <td>
                  <span
                    className={`statusChip ${!row.registered ? "bad" : row.partial ? "warn" : "good"}`}
                  >
                    {!row.registered
                      ? "Не передаёт"
                      : row.partial
                        ? "Частичная передача"
                        : "Передаёт"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="prototypeNote">
        <b>Важно:</b> федеральный свод считает строки объектов/зданий,
        содержащих плановые СП. OID подразделений раскрыты внутри строки;
        «частичная передача» означает, что не все плановые СП объекта передают
        документ.
      </p>
    </section>
  );
}

function MonthlyMoView({
  dataset,
  plan,
  lowerIsBetter,
  query,
  setQuery,
  sortKey,
  sortDirection,
  setSort,
  selectedGuidance,
  selectedMethodology,
  ownership,
  setOwnership,
}: {
  dataset: MonthlyMoDataset;
  plan: number | null;
  lowerIsBetter: boolean;
  query: string;
  setQuery: (v: string) => void;
  sortKey: MoSortKey;
  sortDirection: SortDirection;
  setSort: (k: MoSortKey) => void;
  selectedGuidance?: Guidance;
  selectedMethodology?: Methodology;
  ownership: "state" | "all";
  setOwnership: (v: "state" | "all") => void;
}) {
  const countMode = dataset.unit === "count";
  const previousMonth = dataset.previousLabel ?? "Июнь";
  const currentMonth = dataset.currentLabel ?? "Июль";
  const hasPrevious = dataset.rows.some((row) => row.june !== null);
  const eligibleRows = dataset.rows.filter(
    (r) => !isExcludedFromIndicators(r.name),
  );
  const available = eligibleRows.filter((r) => r.july !== null);
  const managementRows = available.filter(
    (r) => !isPrivateOrganization(r.name) && !isTechnicalRow(r.name),
  );
  const attentionBase = managementRows.filter(
    (r) => !excludedFromAttention(r.name),
  );
  const quantity = (n) =>
    Number(
      String(n ?? "")
        .split("/")[0]
        .replace(/\s/g, ""),
    ) || 0;
  const leaders = [...managementRows]
    .sort((a, b) => {
      const av = a.july ?? 0,
        bv = b.july ?? 0;
      const primary = lowerIsBetter ? av - bv : bv - av;
      return (
        primary ||
        quantity(b.julyQuantity) - quantity(a.julyQuantity) ||
        a.name.localeCompare(b.name, "ru")
      );
    })
    .slice(0, 10);
  const attention = countMode
    ? [...attentionBase]
        .sort((a, b) =>
          lowerIsBetter
            ? (b.july ?? 0) - (a.july ?? 0)
            : (a.july ?? 0) - (b.july ?? 0),
        )
        .slice(0, 10)
    : [...attentionBase]
        .filter((r) => (r.july ?? 0) < (plan ?? 0))
        .sort((a, b) => (a.july ?? 0) - (b.july ?? 0))
        .slice(0, 10);
  const deterioration = [...attentionBase]
    .filter(
      (r) =>
        r.change !== null &&
        (lowerIsBetter ? (r.change ?? 0) > 0 : (r.change ?? 0) < 0),
    )
    .sort((a, b) =>
      lowerIsBetter
        ? (b.change ?? 0) - (a.change ?? 0)
        : (a.change ?? 0) - (b.change ?? 0),
    )
    .slice(0, 10);
  const mapped = (rows: MonthlyMoRow[]): MoRow[] =>
    rows.map((r) => ({
      name: r.name,
      fact: r.july ?? 0,
      previous: r.june,
      trend: r.change,
    }));
  const achieved =
    plan === null
      ? 0
      : available.filter((r) =>
          lowerIsBetter
            ? (r.july ?? Infinity) <= plan
            : (r.july ?? -Infinity) >= plan,
        ).length;
  const improved = available.filter(
    (r) =>
      r.change !== null &&
      (lowerIsBetter ? (r.change ?? 0) < 0 : (r.change ?? 0) > 0),
  ).length;
  const worsened = available.filter(
    (r) =>
      r.change !== null &&
      (lowerIsBetter ? (r.change ?? 0) > 0 : (r.change ?? 0) < 0),
  ).length;
  const value = (r: MonthlyMoRow) => {
    if (sortKey === "name") return cleanMoName(r.name).toLocaleLowerCase("ru");
    if (sortKey === "previous") return r.june ?? -Infinity;
    if (sortKey === "trend") return r.change ?? -Infinity;
    if (sortKey === "quantity") return quantity(r.julyQuantity);
    if (sortKey === "deviation") return (r.july ?? 0) - (plan ?? 0);
    if (sortKey === "status")
      return plan === null
        ? 0
        : (
              lowerIsBetter
                ? (r.july ?? Infinity) <= plan
                : (r.july ?? -Infinity) >= plan
            )
          ? 1
          : 0;
    return r.july ?? -Infinity;
  };
  const visible = [...eligibleRows]
    .filter((r) => ownership === "all" || !isPrivateOrganization(r.name))
    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const av = value(a),
        bv = value(b);
      const c =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "ru")
          : Number(av) - Number(bv);
      return (
        (sortDirection === "asc" ? c : -c) || a.name.localeCompare(b.name, "ru")
      );
    });
  return (
    <>
      <div className="moStats five monthlyStats">
        <article>
          <small>МО в исходнике за {currentMonth.toLowerCase()}</small>
          <strong>{available.length}</strong>
        </article>
        <article>
          <small>
            {countMode ? "С ненулевым результатом" : "Выполнили план"}
          </small>
          <strong className="green">
            {countMode
              ? available.filter((r) => (r.july ?? 0) > 0).length
              : achieved}
          </strong>
        </article>
        <article>
          <small>{countMode ? "Нулевой результат" : "Не выполнили план"}</small>
          <strong className="red">
            {countMode
              ? available.filter((r) => (r.july ?? 0) === 0).length
              : available.length - achieved}
          </strong>
        </article>
        <article>
          <small>Улучшили к {previousMonth.toLowerCase()}</small>
          <strong className="green">{hasPrevious ? improved : "—"}</strong>
        </article>
        <article>
          <small>Ухудшили к {previousMonth.toLowerCase()}</small>
          <strong className="red">{hasPrevious ? worsened : "—"}</strong>
        </article>
      </div>
      <div className="meetingBlocks monthlyRankings">
        <RankingBlock
          title={countMode ? `Наибольший объём: ${currentMonth}` : `Лидеры: ${currentMonth}`}
          subtitle="по результату за полный месяц"
          rows={mapped(leaders)}
          plan={plan ?? 0}
          tone="good"
          countMode={countMode}
          lowerIsBetter={lowerIsBetter}
        />
        <RankingBlock
          title={`Требуют внимания: ${currentMonth}`}
          subtitle="по результату за полный месяц"
          rows={mapped(attention)}
          plan={plan ?? 0}
          tone="bad"
          countMode={countMode}
          lowerIsBetter={lowerIsBetter}
        />
        <RankingBlock
          title="Наибольшее ухудшение"
          subtitle={`${currentMonth.toLowerCase()} по сравнению с ${previousMonth.toLowerCase()}`}
          rows={mapped(deterioration)}
          plan={plan ?? 0}
          tone="warn"
          showTrend
          countMode={countMode}
          lowerIsBetter={lowerIsBetter}
        />
      </div>
      {selectedGuidance && <ActionGuide guidance={selectedGuidance} />}
      {selectedMethodology && (
        <MethodologyGuide methodology={selectedMethodology} />
      )}
      <div className="allMosHead">
        <div>
          <p className="eyebrow">ПОМЕСЯЧНАЯ ДЕТАЛИЗАЦИЯ ПО ОРГАНИЗАЦИЯМ</p>
          <h2>Все медицинские организации</h2>
          <p>{hasPrevious ? `Два полных месяца: ${previousMonth.toLowerCase()} и ${currentMonth.toLowerCase()} 2026 года` : `Полный месяц: ${currentMonth.toLowerCase()} 2026 года; сравнение появится после загрузки ${previousMonth.toLowerCase()}`}</p>
        </div>
        <span>{visible.length} МО</span>
      </div>
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск медицинской организации"
        />
        <select
          value={ownership}
          onChange={(e) => setOwnership(e.target.value as "state" | "all")}
          aria-label="Форма собственности"
        >
          <option value="state">Только государственные МО</option>
          <option value="all">Все МО, включая частные</option>
        </select>
        <span className="sortHint">
          Нажмите заголовок столбца для сортировки
        </span>
      </div>
      <div className="tableWrap">
        <table className="matrix indicatorTable monthlyTable">
          <thead>
            <tr>
              <th>№</th>
              <th>
                <button
                  className={sortKey === "name" ? "sorted" : ""}
                  onClick={() => setSort("name")}
                >
                  Медицинская организация{" "}
                  <i>{sortMarkStatic(sortKey === "name", sortDirection)}</i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "previous" ? "sorted" : ""}
                  onClick={() => setSort("previous")}
                >
                  {previousMonth}{" "}
                  <i>{sortMarkStatic(sortKey === "previous", sortDirection)}</i>
                  <small>полный месяц</small>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "fact" ? "sorted" : ""}
                  onClick={() => setSort("fact")}
                >
                  {currentMonth}{" "}
                  <i>{sortMarkStatic(sortKey === "fact", sortDirection)}</i>
                  <small>полный месяц</small>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "trend" ? "sorted" : ""}
                  onClick={() => setSort("trend")}
                >
                  Изменение{" "}
                  <i>{sortMarkStatic(sortKey === "trend", sortDirection)}</i>
                  <small>{currentMonth.toLowerCase()} к {previousMonth.toLowerCase()}</small>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "deviation" ? "sorted" : ""}
                  onClick={() => setSort("deviation")}
                >
                  План / отклонение{" "}
                  <i>
                    {sortMarkStatic(sortKey === "deviation", sortDirection)}
                  </i>
                </button>
              </th>
              <th>
                <button
                  className={sortKey === "status" ? "sorted" : ""}
                  onClick={() => setSort("status")}
                >
                  Статус: {currentMonth.toLowerCase()}{" "}
                  <i>{sortMarkStatic(sortKey === "status", sortDirection)}</i>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const july = r.july;
              const change = r.change;
              const good =
                plan === null
                  ? null
                  : lowerIsBetter
                    ? (july ?? Infinity) <= plan
                    : (july ?? -Infinity) >= plan;
              const near =
                plan !== null &&
                july !== null &&
                (lowerIsBetter ? july <= plan * 1.1 : july >= plan * 0.9);
              const status: Status = good
                ? "good"
                : near
                  ? "warn"
                  : plan === null
                    ? "na"
                    : "bad";
              const changeGood =
                change !== null && (lowerIsBetter ? change < 0 : change > 0);
              return (
                <tr key={r.name}>
                  <td>
                    <b className="rank">{i + 1}</b>
                  </td>
                  <td>
                    <strong>{cleanMoName(r.name)}</strong>
                    <small>помесячные исходники</small>
                  </td>
                  <td>
                    <b>
                      {r.june === null
                        ? "—"
                        : `${format(r.june, countMode ? 0 : 2)}${countMode ? "" : "%"}`}
                    </b>
                    {r.juneQuantity && <small>{r.juneQuantity}</small>}
                  </td>
                  <td>
                    <b>
                      {july === null
                        ? "—"
                        : `${format(july, countMode ? 0 : 2)}${countMode ? "" : "%"}`}
                    </b>
                    {r.julyQuantity && <small>{r.julyQuantity}</small>}
                  </td>
                  <td>
                    <span
                      className={`trendPill ${change === null ? "" : changeGood ? "up" : change === 0 ? "" : "down"}`}
                    >
                      {change === null
                        ? "—"
                        : `${change > 0 ? "↑" : change < 0 ? "↓" : "→"} ${format(Math.abs(change), countMode ? 0 : 2)}${countMode ? "" : " п.п."}`}
                    </span>
                  </td>
                  <td>
                    {plan === null ? (
                      "план не задан"
                    ) : (
                      <>
                        <b>
                          {format(plan, countMode ? 0 : 2)}
                          {countMode ? "" : "%"}
                        </b>
                        <small
                          className={
                            (july ?? 0) - plan < 0 ? "badText" : "green"
                          }
                        >
                          {july === null
                            ? "—"
                            : `${july - plan >= 0 ? "+" : ""}${format(july - plan, countMode ? 0 : 2)}${countMode ? "" : " п.п."}`}
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={`statusChip ${status}`}>
                      {plan === null
                        ? "Без плана"
                        : good
                          ? "Выполнен"
                          : near
                            ? "Риск"
                            : "Отставание"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="prototypeNote">
        В этом режиме рейтинги, карточки и таблица построены только по полным
        месячным исходникам. Для показателей врачей и 500+ используется полный
        август; неполный сентябрь не включён.
      </p>
    </>
  );
}

function RatingPanel({
  title,
  subtitle,
  rows,
  tone,
  showChange = false,
}: {
  title: string;
  subtitle: string;
  rows: RankRow[];
  tone: string;
  showChange?: boolean;
}) {
  return (
    <article className={`ratingPanel ${tone}`}>
      <div>
        <span>
          <b>{title}</b>
          <small>{subtitle}</small>
        </span>
        <strong>{rows.length}</strong>
      </div>
      <ol>
        {rows.map((row, index) => (
          <li key={row.key}>
            <i>{index + 1}</i>
            <span title={cleanMoName(row.name)}>{cleanMoName(row.name)}</span>
            <b>
              {showChange
                ? row.change === null
                  ? "—"
                  : `${row.change > 0 ? "↑" : row.change < 0 ? "↓" : "→"} ${format(Math.abs(row.change), 1)}`
                : format(row.score, 1)}
            </b>
          </li>
        ))}
      </ol>
    </article>
  );
}

function ActionGuide({ guidance }: { guidance: Guidance }) {
  return (
    <details className="actionGuide">
      <summary>
        <span>
          <b>Что сделать медицинской организации</b>
          <small>{guidance.goal}</small>
        </span>
        <i>⌄</i>
      </summary>
      <div className="actionGuideBody">
        <ol>
          {guidance.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
        <div>
          <span>
            <small>Ответственные</small>
            <b>{guidance.owner}</b>
          </span>
          <span>
            <small>Контроль</small>
            <b>{guidance.cadence}</b>
          </span>
          {guidance.caution && <p>{guidance.caution}</p>}
        </div>
      </div>
    </details>
  );
}

function MethodologyGuide({ methodology }: { methodology: Methodology }) {
  return (
    <details className="methodCard indicatorMethodology" open>
      <summary>
        <span>
          <b>М</b>
          <strong>Методика расчёта</strong>
        </span>
        <i>⌄</i>
      </summary>
      <div className="methodBody">
        <div className="methodFormula">
          <small>Формула</small>
          <strong>{methodology.formula}</strong>
        </div>
        <div className="methodParts">
          <article>
            <small>Числитель / учитываемое значение</small>
            <p>{methodology.numerator}</p>
          </article>
          <article>
            <small>Знаменатель</small>
            <p>{methodology.denominator}</p>
          </article>
          <article>
            <small>Источник</small>
            <p>{methodology.source}</p>
          </article>
          <article>
            <small>Период расчёта</small>
            <p>{methodology.cadence}</p>
          </article>
        </div>
        {methodology.note && (
          <p className="methodNote">
            <b>Важные условия:</b> {methodology.note}
          </p>
        )}
      </div>
    </details>
  );
}

function sortMarkStatic(active: boolean, direction: SortDirection) {
  return active ? (direction === "asc" ? "↑" : "↓") : "↕";
}

function RankingBlock({
  metric,
  title,
  subtitle,
  rows,
  plan,
  tone,
  showTrend = false,
  countMode = false,
  lowerIsBetter = false,
  gapMode = false,
  emptyText = "Нет данных для сравнения периодов",
}: {
  metric?: string;
  title: string;
  subtitle: string;
  rows: MoRow[];
  plan: number;
  tone: string;
  showTrend?: boolean;
  countMode?: boolean;
  lowerIsBetter?: boolean;
  gapMode?: boolean;
  emptyText?: string;
}) {
  const max = Math.max(...rows.map((r) => r.fact), 1);
  return (
    <article
      className={`rankingBlock ${tone} ${showTrend ? "changeBlock" : ""} ${gapMode ? "gapRanking" : ""}`}
    >
      <div className="rankingTitle">
        <div>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
        <b>{rows.length}</b>
      </div>
      <div className="rankingRows">
        {rows.length === 0 ? (
          <p className="emptyRanking">{emptyText}</p>
        ) : (
          rows.map((r, i) => {
            const displayName = metric
              ? reportMoName(metric, r.name)
              : cleanMoName(r.name);
            const target =
              r.volume === null || r.volume === undefined
                ? null
                : Math.ceil((r.volume * plan) / 100);
            const gap =
              target === null
                ? null
                : Math.max(0, target - Number(r.count ?? 0));
            return (
              <div key={r.name}>
                <span className="miniRank">{i + 1}</span>
                <p title={displayName}>
                  {displayName}
                  {gapMode && (
                    <small>
                      {format(r.count ?? 0, 0)} из {format(r.volume ?? 0, 0)}
                    </small>
                  )}
                </p>
                {gapMode ? (
                  <b className={r.fact >= plan ? "green" : "badText"}>
                    <span>{format(r.fact, 2)}%</span>
                    {gap !== null && gap > 0 && (
                      <small>не хватает {format(gap, 0)}</small>
                    )}
                  </b>
                ) : showTrend ? (
                  <b
                    className={
                      !countMode && r.fact < plan ? "badText" : "green"
                    }
                  >
                    {format(r.fact, countMode ? 0 : 2)}
                    {countMode ? "" : "%"}
                  </b>
                ) : (
                  <div className="miniBar">
                    <i
                      style={{
                        width: `${Math.min((r.fact / (countMode ? max : Math.max(plan, 1))) * 100, 100)}%`,
                      }}
                    />
                  </div>
                )}
                {!gapMode && (
                  <strong
                    className={
                      showTrend &&
                      r.trend !== null &&
                      (lowerIsBetter ? r.trend > 0 : r.trend < 0)
                        ? "badText"
                        : ""
                    }
                  >
                    {showTrend && r.trend !== null
                      ? `${r.trend > 0 ? "↑" : r.trend < 0 ? "↓" : "→"} ${format(Math.abs(r.trend), countMode ? 0 : 2)}${countMode ? "" : " п.п."}`
                      : `${format(r.fact, countMode ? 0 : 2)}${countMode ? "" : "%"}`}
                  </strong>
                )}
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
