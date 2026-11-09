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
