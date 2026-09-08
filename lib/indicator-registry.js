/**
 * Runtime access layer for the canonical indicator registry.
 *
 * Stage 6 rule: plans, evaluation direction, period kind and rating metadata
 * are read from config/indicator-registry.json instead of being duplicated in
 * UI/runtime code. Data values and calculation formulas remain in their
 * existing deterministic sources.
 */

const VALID_DIRECTIONS = new Set(["higher", "lower"]);
const VALID_PERIOD_KINDS = new Set(["monthly", "cumulative", "operational", "snapshot"]);
const VALID_RATING_POLICIES = new Set(["include", "exclude", "conditional", "not_applicable"]);
const VALID_RATING_BLOCKS = new Set(["care", "services", "readiness"]);

export function createIndicatorRegistryRuntime(registry) {
  if (!registry || typeof registry !== "object") throw new Error("indicator registry is required");
  const indicators = registry.indicators ?? {};
  const weights = registry.rating?.blocks ?? {};

  function requireIndicator(id) {
    const item = indicators[id];
    if (!item) throw new Error(`indicator registry missing ${id}`);
    return item;
  }

  function get(id) {
    return indicators[id] ?? null;
  }

  function plan(id, fallback = null) {
    const item = get(id);
    return item ? (item.plan?.value ?? null) : fallback;
  }

  function planPeriod(id, fallback = null) {
    const item = get(id);
    return item ? (item.plan?.period ?? null) : fallback;
  }

  function direction(id, fallback = "higher") {
    const value = get(id)?.direction;
    return VALID_DIRECTIONS.has(value) ? value : fallback;
  }

  function periodKind(id, fallback = "snapshot") {
    const value = get(id)?.period?.kind;
    return VALID_PERIOD_KINDS.has(value) ? value : fallback;
  }

  function ratingPolicy(id) {
    const value = get(id)?.rating?.policy;
    return VALID_RATING_POLICIES.has(value) ? value : "not_applicable";
  }

  function ratingBlock(id) {
    const value = get(id)?.rating?.block;
    return VALID_RATING_BLOCKS.has(value) ? value : "readiness";
  }

  function ratingWeight(block) {
    const value = weights?.[block];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function canEnterRating(id) {
    const policy = ratingPolicy(id);
    return policy === "include" || policy === "conditional";
  }

  function baselineRatingActive(id) {
    return get(id)?.rating?.baselineActive === true;
  }

  function exclusions(id) {
    const value = get(id)?.exclusions;
    return Array.isArray(value) ? [...value] : [];
  }

  function affectsHearingPriority(id) {
    return get(id)?.management?.hearingPriority !== false;
  }

  function rowExclusionRules(id) {
    const value = get(id)?.rowExclusionRules;
    return Array.isArray(value) ? [...value] : [];
  }

  function hasRowExclusion(id, rule) {
    return rowExclusionRules(id).includes(rule);
  }

  function metadata(id) {
    const item = requireIndicator(id);
    return {
      id,
      plan: item.plan?.value ?? null,
      planPeriod: item.plan?.period ?? null,
      direction: direction(id),
      periodKind: periodKind(id),
      unit: item.unit ?? null,
      ratingPolicy: ratingPolicy(id),
      ratingActive: baselineRatingActive(id),
      ratingBlock: ratingBlock(id),
      exclusions: exclusions(id),
      hearingPriority: affectsHearingPriority(id),
      rowExclusionRules: rowExclusionRules(id),
    };
  }

  function applyToDataset(id, dataset) {
    const item = get(id);
    if (!item || !dataset || typeof dataset !== "object") return dataset;
    const dir = direction(id);
    return {
      ...dataset,
      plan: item.plan?.value ?? null,
      direction: dir === "lower" ? "lower" : undefined,
      periodKind: periodKind(id),
    };
  }

  function applyToDatasetMap(datasetMap = {}) {
    return Object.fromEntries(
      Object.entries(datasetMap).map(([id, dataset]) => [id, applyToDataset(id, dataset)]),
    );
  }

  function applyToStaticIndicator(indicator) {
    if (!indicator || !indicator.id) return indicator;
    const item = get(indicator.id);
    if (!item) return indicator;
    return {
      ...indicator,
      plan: item.plan?.value ?? null,
      reverse: direction(indicator.id) === "lower" || undefined,
      planPeriod: item.plan?.period ?? undefined,
      periodKind: periodKind(indicator.id),
    };
  }

  function applyToStaticIndicators(items = []) {
    return items.map(applyToStaticIndicator);
  }

  function validate() {
    const issues = [];
    for (const [id, item] of Object.entries(indicators)) {
      if (!VALID_DIRECTIONS.has(item?.direction)) issues.push(`${id}:direction`);
      if (!VALID_PERIOD_KINDS.has(item?.period?.kind)) issues.push(`${id}:period.kind`);
      if (!VALID_RATING_POLICIES.has(item?.rating?.policy)) issues.push(`${id}:rating.policy`);
      if (!VALID_RATING_BLOCKS.has(item?.rating?.block)) issues.push(`${id}:rating.block`);
    }
    const weightSum = Object.values(weights).reduce(
      (sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0),
      0,
    );
    if (Math.abs(weightSum - 1) > 1e-9) issues.push("rating.blocks:sum");
    return { ok: issues.length === 0, issues };
  }

  return {
    registry,
    indicators,
    get,
    requireIndicator,
    plan,
    planPeriod,
    direction,
    periodKind,
    ratingPolicy,
    ratingBlock,
    ratingWeight,
    canEnterRating,
    baselineRatingActive,
    exclusions,
    affectsHearingPriority,
    rowExclusionRules,
    hasRowExclusion,
    metadata,
    applyToDataset,
    applyToDatasetMap,
    applyToStaticIndicator,
    applyToStaticIndicators,
    validate,
  };
}
