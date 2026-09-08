/**
 * Deterministic calculation primitives for the RT healthcare dashboard.
 *
 * Stage 5 rule: a regional indicator value is derived once here and then
 * reused by runtime consumers. The module intentionally contains no UI code.
 */

const number = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function ratioPercent(numerator, denominator) {
  const n = number(numerator);
  const d = number(denominator);
  return d ? (n / d) * 100 : 0;
}

export function aggregateComponents(details = []) {
  const rows = Array.isArray(details) ? details : Object.values(details ?? {});
  const numerator = rows.reduce((sum, row) => sum + number(row?.registered), 0);
  const denominator = rows.reduce((sum, row) => sum + number(row?.volume), 0);
  return {
    numerator,
    denominator,
    fact: ratioPercent(numerator, denominator),
  };
}

export function aggregateCountRows(rows = [], includeRow = () => true) {
  return rows
    .filter((row) => includeRow(row))
    .reduce((sum, row) => sum + number(row?.fact), 0);
}

export function parseQuantityPair(value) {
  const match = String(value ?? "").match(/([\d\s]+)\s*(?:\/|из)\s*([\d\s]+)/iu);
  if (!match) return null;
  return {
    numerator: Number(match[1].replace(/\s/gu, "")),
    denominator: Number(match[2].replace(/\s/gu, "")),
  };
}

export function aggregateQuantityPairs(rows = [], field) {
  let numerator = 0;
  let denominator = 0;
  let parsed = 0;
  for (const row of rows) {
    const pair = parseQuantityPair(row?.[field]);
    if (!pair) continue;
    numerator += pair.numerator;
    denominator += pair.denominator;
    parsed += 1;
  }
  return {
    numerator,
    denominator,
    fact: ratioPercent(numerator, denominator),
    parsed,
  };
}

export function scoreAgainstPlan({ fact, plan, direction = "higher", reverse = false }) {
  if (fact === null || fact === undefined || plan === null || plan === undefined)
    return null;
  const lowerIsBetter = reverse || direction === "lower";
  const raw = lowerIsBetter
    ? fact <= 0
      ? 100
      : (plan / fact) * 100
    : plan <= 0
      ? fact >= plan
        ? 100
        : 0
      : (fact / plan) * 100;
  return Math.max(0, Math.min(raw, 100));
}

export function passedPlan({ fact, plan, direction = "higher", reverse = false }) {
  if (fact === null || fact === undefined || plan === null || plan === undefined)
    return null;
  return reverse || direction === "lower" ? fact <= plan : fact >= plan;
}

export function targetLag({ numerator, denominator, plan, direction = "higher" }) {
  if (
    numerator === null || numerator === undefined ||
    denominator === null || denominator === undefined ||
    plan === null || plan === undefined
  ) return null;
  if (direction === "lower") return null;
  return Math.max(0, Math.ceil(number(denominator) * number(plan) / 100) - number(numerator));
}

function sourceBackedCalculation(indicator, details, dataset, noun) {
  const aggregate = aggregateComponents(details);
  return {
    ...indicator,
    fact: aggregate.fact,
    quantity: aggregate.numerator,
    lag: aggregate.denominator - aggregate.numerator,
    quantityLabel: `из ${new Intl.NumberFormat("ru-RU").format(aggregate.denominator)} ${noun ?? "единиц"}`,
    date: dataset.date,
    calculation: {
      method: "ratio_components",
      numerator: aggregate.numerator,
      denominator: aggregate.denominator,
      source: "mo-details",
    },
  };
}

function presenceCalculation(indicator, dataset) {
  const numerator = dataset.rows.filter((row) => number(row?.fact) > 0).length;
  const denominator = dataset.rows.length;
  return {
    ...indicator,
    fact: ratioPercent(numerator, denominator),
    quantity: numerator,
    lag: denominator - numerator,
    quantityLabel: `из ${denominator} медицинских организаций`,
    date: dataset.date,
    calculation: {
      method: "presence_rows",
      numerator,
      denominator,
      source: "mo-data",
    },
  };
}

function physicianIndicator(id, dataset, reportingLabel) {
  return {
    id,
    group: "Врачи и СЭМД",
    name: dataset.name,
    fact: dataset.summary.fact,
    plan: dataset.plan,
    unit: "%",
    trend: null,
    date: dataset.date,
    lag: targetLag({
      numerator: dataset.summary.numerator,
      denominator: dataset.summary.denominator,
      plan: dataset.plan,
    }),
    quantity: dataset.summary.numerator,
    quantityLabel: `из ${new Intl.NumberFormat("ru-RU").format(dataset.summary.denominator)} врачей · ${reportingLabel}`,
    planPeriod: "за полный календарный месяц",
    calculation: {
      method: "source_summary",
      numerator: dataset.summary.numerator,
      denominator: dataset.summary.denominator,
      source: "physician-metrics",
    },
  };
}

/**
 * Reproduces the approved v4.6.0 runtime calculation order.
 * Static indicators are only the metadata/fallback layer; source-backed,
 * presence and physician values are resolved once in this engine.
 */
export function createIndicatorCalculationRuntime({
  staticIndicators = [],
  physicianMetrics = { datasets: {} },
  moData = {},
  moDetails = {},
  moDetailOids = {},
  preventiveSemdAudit = null,
  preventiveChildOids = new Set(),
  blockedIndicatorIds = new Set(),
  sourceBackedIndicatorIds = new Set(),
  sourceQuantityNouns = {},
  reportingLabel = "",
  includeDatasetRow = () => true,
}) {
  const physicianIndicators = Object.entries(physicianMetrics?.datasets ?? {}).map(
    ([id, dataset]) => physicianIndicator(id, dataset, reportingLabel),
  );

  const indicators = [...staticIndicators, ...physicianIndicators].map((indicator) => {
    if (blockedIndicatorIds.has(indicator.id)) {
      return {
        ...indicator,
        plan: null,
        trend: null,
        provisional: true,
        calculation: { method: "blocked", source: "baseline-rule" },
      };
    }

    if (
      indicator.id === "semd228" &&
      preventiveSemdAudit?.summary?.status === "blocked"
    ) {
      const details = Object.entries(moDetailOids?.semd228 ?? {})
        .filter(([oid]) => !preventiveChildOids.has(oid))
        .map(([, detail]) => detail);
      const aggregate = aggregateComponents(details);
      return {
        ...indicator,
        fact: aggregate.fact,
        quantity: aggregate.numerator,
        lag: aggregate.denominator - aggregate.numerator,
        quantityLabel: `из ${new Intl.NumberFormat("ru-RU").format(aggregate.denominator)} обращений взрослых МО · временно по СЭМД 228`,
        provisional: true,
        calculation: {
          method: "ratio_components_adult_only",
          numerator: aggregate.numerator,
          denominator: aggregate.denominator,
          source: "mo-detail-oids",
        },
      };
    }

    if (indicator.id === "elmk" || indicator.id === "tmkRemd") {
      const dataset = moData[indicator.id];
      if (dataset?.rows?.length) return presenceCalculation(indicator, dataset);
    }

    if (sourceBackedIndicatorIds.has(indicator.id)) {
      const details = Object.values(moDetails?.[indicator.id] ?? {});
      const dataset = moData[indicator.id];
      if (details.length && dataset) {
        return sourceBackedCalculation(
          indicator,
          details,
          dataset,
          sourceQuantityNouns[indicator.id],
        );
      }
    }

    return {
      ...indicator,
      calculation: indicator.calculation ?? { method: "static_fallback", source: "page-baseline" },
    };
  });

  const byId = Object.fromEntries(indicators.map((indicator) => [indicator.id, indicator]));
  const datasetById = {};
  for (const [id, dataset] of Object.entries(moData ?? {})) {
    if (byId[id] || !Array.isArray(dataset?.rows)) continue;
    const rows = dataset.rows.filter((row) => includeDatasetRow(id, row));
    if (dataset.mode === "count") {
      const fact = aggregateCountRows(rows);
      const previous = rows.reduce((sum, row) => sum + number(row?.previous), 0);
      datasetById[id] = {
        id,
        name: dataset.name,
        fact,
        previous,
        trend: fact - previous,
        plan: dataset.plan ?? null,
        unit: dataset.unit ?? "",
        date: dataset.date ?? "",
        direction: dataset.direction ?? "higher",
        quantity: fact,
        calculation: {
          method: "count_rows",
          source: "mo-data",
          numerator: fact,
        },
      };
    }
  }
  const allById = { ...datasetById, ...byId };
  return {
    indicators,
    byId,
    datasetById,
    allById,
    get(id) {
      return allById[id] ?? null;
    },
  };
}
