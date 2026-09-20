/** Stable release identity plus operational labels derived from accepted runtime data. */
export const RELEASE_VERSION = "5.4.6";

function endFromPeriod(period, fallback) {
  const matches = String(period ?? "").match(/(\d{2}\.\d{2}\.\d{4})/g);
  return matches?.at(-1) ?? fallback ?? null;
}

export function createReleaseRuntimeMetadata({ operationalRuntime = {}, physicianWeeklySnapshot = {} } = {}) {
  const period = physicianWeeklySnapshot.period ?? operationalRuntime.doctorsAll?.period ?? null;
  const end = physicianWeeklySnapshot.date ?? endFromPeriod(period, operationalRuntime.doctorsAll?.date);
  return {
    version: RELEASE_VERSION,
    operationalCut: { period, date: end, source: physicianWeeklySnapshot.source ?? operationalRuntime.doctorsAll?.source ?? null },
    ratingPeriod: "август 2026",
  };
}
