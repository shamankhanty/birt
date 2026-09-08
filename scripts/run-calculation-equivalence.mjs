import fs from "node:fs";
import { createIndicatorCalculationRuntime } from "../lib/calculation-engine.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const semantic = read("baseline/semantic-snapshot.json");
const expected = read("baseline/calculation-runtime-snapshot.json");
const physicianMetrics = read("app/physician-metrics.json");
const moDetails = read("app/mo-details.json");
const moDetailOids = read("app/mo-detail-oids.json");
const preventiveSemdAudit = read("app/preventive-semd-audit.json");
const moData = {
  ...read("app/mo-data.json"),
  ...read("app/operational-mo.json"),
  ...read("app/organization-status.json"),
  ...physicianMetrics.datasets,
};
const sourceBackedIndicatorIds = new Set(["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"]);
function isTechnicalRow(name) {
  return /^\s*(?:итого|всего по|неизвестная МО)/iu.test(name);
}
function isExcludedFromIndicators(name) {
  const normalized = String(name ?? "").replace(/[«»"']/g, " ").replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
  return (
    /(?:^|\s)КГМА(?=\s|$).*?(?:^|\s)РМАНПО(?=\s|$)/iu.test(normalized) ||
    /(?:^|\s)[АР]ЦОЗ\s+и\s+МП(?:\s|$)/iu.test(normalized) ||
    /(?:^|\s)Казанск(?:ий|ого)\s+ГМУ(?=\s|$).*?(?:^|\s)Минздрава\s+России/iu.test(normalized)
  );
}
function isMaxProfileInapplicable(name) {
  return /ркпд|противотуберкул|(?:^|\s)птд(?:\s|$)/iu.test(String(name ?? "").toLocaleLowerCase("ru"));
}
const includeDatasetRow = (id, row) =>
  !isTechnicalRow(row.name) && !isExcludedFromIndicators(row.name) &&
  (!(id === "tmkMaxCount" || id === "elnMaxCount") || !isMaxProfileInapplicable(row.name));

const sourceQuantityNouns = {
  egpu: "поданных заявлений",
  egpu2days: "поданных заявлений",
  birth: "свидетельств",
  death: "свидетельств",
  semd228: "обращений",
  hospital: "случаев",
  ambulatoryCase: "амбулаторных случаев",
  smp: "карт вызова",
};
const staticIndicators = Object.entries(semantic.regionalCards).map(([id, card]) => ({
  id,
  group: "snapshot",
  name: id,
  fact: card.fact,
  plan: card.plan,
  unit: ["tmkMax", "elnMax", "visitMax"].includes(id) ? "" : "%",
  trend: null,
  date: card.date,
  lag: null,
  reverse: card.direction === "lower",
}));
const runtime = createIndicatorCalculationRuntime({
  staticIndicators,
  physicianMetrics,
  moData,
  moDetails,
  moDetailOids,
  preventiveSemdAudit,
  preventiveChildOids: new Set(preventiveSemdAudit.rows.filter((row) => row.child).map((row) => row.oid)),
  blockedIndicatorIds: new Set(),
  sourceBackedIndicatorIds,
  sourceQuantityNouns,
  reportingLabel: "август 2026",
  includeDatasetRow,
});

const mismatches = [];
for (const [id, item] of Object.entries(expected.allIndicators)) {
  const actual = runtime.allById[id];
  const fields = {
    fact: actual?.fact ?? null,
    plan: actual?.plan ?? null,
    date: actual?.date ?? null,
    previous: actual?.previous ?? null,
    trend: actual?.trend ?? null,
    quantity: actual?.quantity ?? null,
  };
  for (const [field, actualValue] of Object.entries(fields)) {
    const expectedValue = item[field] ?? null;
    if (!Object.is(actualValue, expectedValue)) mismatches.push({ id, field, expected: expectedValue, actual: actualValue });
  }
}

const report = {
  schemaVersion: 1,
  baselineVersion: expected.baselineVersion,
  status: mismatches.length ? "FAIL" : "PASS",
  checkedIndicators: Object.keys(expected.allIndicators).length,
  registryCoverage: `${Object.keys(expected.allIndicators).length}/38`,
  mismatches,
  preservedBaselineConflicts: expected.approvedStaticVsRuntimeDivergences,
  note: "PASS means the current deterministic calculation layer reproduces the approved runtime snapshot.",
};
fs.mkdirSync("validation", { recursive: true });
fs.writeFileSync("validation/calculation-equivalence.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (mismatches.length) process.exit(1);
