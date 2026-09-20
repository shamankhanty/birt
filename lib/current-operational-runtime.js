/**
 * Derives operational metadata from accepted production datasets.
 * Registry metadata is intentionally not consulted here.
 */
export function createCurrentOperationalRuntime({ moData = {}, operationalMo = {}, organizationStatus = {}, physicianMetrics = {}, physicianWeeklySnapshot = {}, errorCategories = {} } = {}) {
  const datasets = { ...moData, ...operationalMo, ...organizationStatus, ...(physicianMetrics.datasets ?? {}) };
  const runtime = {};
  for (const [id, dataset] of Object.entries(datasets)) {
    if (!dataset || typeof dataset !== "object") continue;
    runtime[id] = {
      date: dataset.date ?? null,
      period: dataset.period ?? null,
      source: dataset.source ?? null,
      previousDate: dataset.previousDate ?? null,
      previousPeriod: dataset.previousPeriod ?? null,
      fact: dataset.fact ?? dataset.value ?? (
        typeof dataset.numerator === "number" && typeof dataset.denominator === "number" && dataset.denominator !== 0
          ? (dataset.numerator / dataset.denominator) * 100
          : null
      ),
      total: dataset.total ?? dataset.quantity ?? null,
      numerator: typeof dataset.numerator === "number" ? dataset.numerator : null,
      denominator: typeof dataset.denominator === "number" ? dataset.denominator : null,
      derivedFact: typeof dataset.numerator === "number" && typeof dataset.denominator === "number" && dataset.denominator !== 0
        ? (dataset.numerator / dataset.denominator) * 100
        : null,
      comparisonLabel: dataset.previousDate ? `На ${dataset.previousDate.slice(0, 5)}` : null,
      note: dataset.note ?? null,
    };
  }
  if (physicianWeeklySnapshot?.period) runtime.doctorsAll = { ...runtime.doctorsAll, date: physicianWeeklySnapshot.date, period: physicianWeeklySnapshot.period, source: physicianWeeklySnapshot.source };
  if (errorCategories?.period) runtime.errors = { date: errorCategories.date ?? null, period: errorCategories.period, source: errorCategories.source ?? null, total: errorCategories.total ?? null };
  return runtime;
}
