// Compare unrounded values only within the same indicator and target.
export function planTransition(row, plan, { lowerIsBetter = false, disabled = false } = {}) {
  if (disabled || !Number.isFinite(plan) || !Number.isFinite(row.fact) ||
      !Number.isFinite(row.previous) || row.sourceStatus === 'no_source_row') return null;
  const meets = value => lowerIsBetter ? value <= plan : value >= plan;
  const before = meets(row.previous), now = meets(row.fact);
  return before === now ? null : now ? 'reached' : 'lost';
}
