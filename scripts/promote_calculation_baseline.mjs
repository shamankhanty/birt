import fs from "node:fs";
import { createIndicatorCalculationRuntime } from "../lib/calculation-engine.js";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const snapshot = read("baseline/calculation-runtime-snapshot.json");
const semantic = read("baseline/semantic-snapshot.json");
const physicianMetrics = read("app/physician-metrics.json");
const moDetails = read("app/mo-details.json");
const moDetailOids = read("app/mo-detail-oids.json");
const preventiveSemdAudit = read("app/preventive-semd-audit.json");
const moData = { ...read("app/mo-data.json"), ...read("app/operational-mo.json"), ...read("app/organization-status.json"), ...physicianMetrics.datasets };
function isTechnicalRow(name) { return /^\s*(?:итого|всего по|неизвестная МО)/iu.test(name); }
function isExcludedFromIndicators(name) {
  const normalized = String(name ?? "").replace(/[«»"']/g, " ").replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
  return /(?:^|\s)КГМА(?=\s|$).*?(?:^|\s)РМАНПО(?=\s|$)/iu.test(normalized) ||
    /(?:^|\s)[АР]ЦОЗ\s+и\s+МП(?:\s|$)/iu.test(normalized) ||
    /(?:^|\s)Казанск(?:ий|ого)\s+ГМУ(?=\s|$).*?(?:^|\s)Минздрава\s+России/iu.test(normalized);
}
function isMaxProfileInapplicable(name) { return /ркпд|противотуберкул|(?:^|\s)птд(?:\s|$)/iu.test(String(name ?? "").toLocaleLowerCase("ru")); }
const includeDatasetRow = (id, row) => !isTechnicalRow(row.name) && !isExcludedFromIndicators(row.name) && (!(id === "tmkMaxCount" || id === "elnMaxCount") || !isMaxProfileInapplicable(row.name));
const staticIndicators = Object.entries(semantic.regionalCards).map(([id, card]) => ({ id, group: "snapshot", name: id, fact: card.fact, plan: card.plan, unit: ["tmkMax", "elnMax", "visitMax"].includes(id) ? "" : "%", trend: null, date: card.date, lag: null, reverse: card.direction === "lower" }));
const runtime = createIndicatorCalculationRuntime({
  staticIndicators, physicianMetrics, moData, moDetails, moDetailOids, preventiveSemdAudit,
  preventiveChildOids: new Set(preventiveSemdAudit.rows.filter((row) => row.child).map((row) => row.oid)),
  blockedIndicatorIds: new Set(), sourceBackedIndicatorIds: new Set(["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"]),
  sourceQuantityNouns: {}, reportingLabel: "сентябрь 2026", includeDatasetRow,
});
for (const [id, expected] of Object.entries(snapshot.allIndicators)) {
  const actual = runtime.allById[id];
  if (!actual) continue;
  for (const field of ["fact", "plan", "date", "previous", "trend", "quantity"]) expected[field] = actual[field] ?? null;
  if (actual.calculation) {
    expected.numerator = actual.calculation.numerator ?? expected.numerator ?? null;
    expected.denominator = actual.calculation.denominator ?? expected.denominator ?? null;
    expected.method = actual.calculation.method ?? expected.method ?? null;
  }
}
for (const [id, expected] of Object.entries(snapshot.regional ?? {})) {
  const actual = runtime.byId[id];
  if (!actual) continue;
  expected.fact = actual.fact;
  expected.date = actual.date;
  expected.method = actual.calculation?.method ?? null;
}
for (const [id, expected] of Object.entries(snapshot.physician ?? {})) {
  const actual = runtime.byId[id];
  if (!actual) continue;
  expected.fact = actual.fact;
  expected.plan = actual.plan;
  expected.date = actual.date;
  expected.numerator = actual.calculation?.numerator ?? null;
  expected.denominator = actual.calculation?.denominator ?? null;
  expected.method = actual.calculation?.method ?? null;
}
snapshot.baselineVersion = "5.4.10";
snapshot.rule = "Snapshot фиксирует утверждённый runtime после обновления источников за сентябрь 2026; месячный рейтинг использует последний полный месяц.";
fs.writeFileSync("baseline/calculation-runtime-snapshot.json", JSON.stringify(snapshot, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", baselineVersion: snapshot.baselineVersion }));
