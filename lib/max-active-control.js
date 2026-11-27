import { filterActiveOrganizationRows } from "./mo-reorganization.js";

// Keep the approved republican plan intact. The old organization rows
// remain in the source files and are available in the archive.
export function activeMaxPlanMetric(metric, date, archive = false) {
  if (archive || !metric || !Array.isArray(metric.rows)) return metric;
  const rows = filterActiveOrganizationRows({date, rows:metric.rows}).rows;
  if (rows.length === metric.rows.length) return metric;
  const retained = new Set(rows.map(r => r.oid));
  const removed = metric.rows.filter(r => !retained.has(r.oid));
  const sum = (field) => rows.reduce((total,row) => total + (row[field] ?? 0),0);
  return {...metric, rows,
    plannedMoFact: metric.plannedMoFact == null ? null : sum("fact"),
    previousPlannedMoFact: metric.previousPlannedMoFact == null ? null : sum("previous"),
    plannedCoverage:{matched:rows.filter(r=>r.fact != null).length,missing:rows.filter(r=>r.fact == null).length},
    archivedCount:removed.length,
    archivedPlan:removed.reduce((total,row)=>total+(row.plan??0),0)
  };
}

export function maxPlanTone(percent) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "neutral";
  if (percent >= 100) return "good";
  if (percent >= 95) return "near";
  if (percent >= 80) return "warn";
  return "bad";
}
