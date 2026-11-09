/**
 * EPL display scope. Exclude only a confirmed zero fleet, never a missing value.
 * The source and regional aggregates remain unchanged.
 */
export function excludeZeroFleetOrganizations(rows) {
  return rows.filter(row => row.vehicles !== 0);
}
