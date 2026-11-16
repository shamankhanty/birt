/**
 * Display scope of the electronic waybill (ЭПЛ) organization tables.
 * A confirmed zero-sized fleet is not a participant in fleet-use rankings.
 * Source rows and regional source-header totals remain untouched.
 *
 * Missing fleet data are not interpreted as a confirmed zero.
 */
export function excludeWaybillGroupsWithoutTransport(rows) {
  return rows.filter(row => row.vehicles !== 0);
}

/**
 * Contribution of an organization to the regional share of vehicles without
 * recorded movement. The denominator is the authoritative REGIONAL header
 * fleet count for the same period, not the number of organizations, nor the
 * filtered display rows. Units: percentage points of the regional fleet.
 *
 * This is an observed risk concentration, NOT a plan-execution deficit:
 * there is no approved EПЛ target in the data source.
 */
export function waybillUnrecordedMovement(row) {
  if (!Number.isFinite(row?.vehicles) || !Number.isFinite(row?.moved) ||
      row.vehicles <= 0 || row.moved < 0 || row.moved > row.vehicles) return null;
  return row.vehicles - row.moved;
}

export function waybillRegionalNonMovementImpact(row, regionalFleet) {
  const missing = waybillUnrecordedMovement(row);
  if (missing === null || !Number.isFinite(regionalFleet) || regionalFleet <= 0) return null;
  return (missing / regionalFleet) * 100;
}

/** Share of this organization's vehicles with NO recorded movement, %.
 * Unlike regionalImpact (percentage points), this denominator is the
 * organization's own fleet. Missing data must never become 0%.
 */
export function waybillOrganizationNoMovementPercent(row) {
  const idle = waybillUnrecordedMovement(row);
  return idle === null ? null : idle / row.vehicles * 100;
}

/** Largest contribution first. Persistent zero movement is a flag, not a
 * priority override; otherwise a tiny fleet may displace a much larger risk. */
export function rankWaybillByRegionalImpact(rows, regionalFleet, count = 10) {
  if (!Number.isFinite(regionalFleet) || regionalFleet <= 0) return [];
  return rows
    .filter(row => { const idle = waybillUnrecordedMovement(row); return idle !== null && idle > 0; })
    .sort((a, b) =>
      waybillUnrecordedMovement(b) - waybillUnrecordedMovement(a) ||
      (a.movementShare ?? Infinity) - (b.movementShare ?? Infinity) ||
      b.vehicles - a.vehicles ||
      a.name.localeCompare(b.name, 'ru') ||
      a.sourceNumber - b.sourceNumber
    )
    .slice(0, count);
}
