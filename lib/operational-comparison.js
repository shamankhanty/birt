const DAY = 86_400_000;

export function snapshotDay(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value ?? "");
  if (!match) return null;
  const day = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return new Date(day).toISOString().slice(0, 10) ===
    `${match[3]}-${match[2]}-${match[1]}` ? day : null;
}

const rowKey = (row) => row.oid ? String(row.oid) : String(row.name ?? "").trim().toLocaleLowerCase("ru");

export function selectOperationalComparison(current, history = [], minimumDays = 5) {
  const currentDay = snapshotDay(current.date);
  const candidates = [...history];
  if (current.previousDate && current.rows?.some((row) => row.previous != null)) {
    candidates.push({
      date: current.previousDate,
      period: current.previousPeriod,
      numerator: current.previousNumerator,
      denominator: current.previousDenominator,
      rows: current.rows.map((row) => ({ ...row, fact: row.previous })),
      legacy: true,
    });
  }
  const resetDay = Math.max(0, ...history
    .filter((cut) => cut.comparisonReset)
    .map((cut) => snapshotDay(cut.date) ?? 0));
  const previous = currentDay === null || current.comparisonReset ? null : candidates
    .filter((cut) => {
      const day = snapshotDay(cut.date);
      return day !== null && day >= resetDay && currentDay - day >= minimumDays * DAY;
    })
    .sort((a, b) => snapshotDay(b.date) - snapshotDay(a.date))[0] ?? null;
  if (!previous) return {
    ...current, previousDate: undefined, previousPeriod: undefined,
    previousNumerator: null, previousDenominator: null, comparisonFact: null,
    rows: (current.rows ?? []).map((row) => ({ ...row, previous: null, trend: null })),
  };
  if (previous.legacy) return { ...current, comparisonFact: null, comparisonFromHistory: false };
  const byKey = new Map((previous.rows ?? []).map((row) => [rowKey(row), row]));
  return {
    ...current,
    previousDate: previous.date,
    previousPeriod: previous.period,
    previousNumerator: previous.numerator ?? null,
    previousDenominator: previous.denominator ?? null,
    comparisonFact: previous.fact ?? (previous.denominator > 0
      ? previous.numerator / previous.denominator * 100
      : current.mode === "count"
        ? (previous.rows ?? []).reduce((sum, row) => sum + Number(row.fact ?? 0), 0)
        : null),
    comparisonFromHistory: true,
    rows: (current.rows ?? []).map((row) => {
      const value = byKey.get(rowKey(row))?.fact;
      return { ...row, previous: value ?? null,
        trend: value == null || row.fact == null ? null : row.fact - value };
    }),
  };
}
