import fs from "node:fs";
import crypto from "node:crypto";
import { createIndicatorCalculationRuntime } from "../lib/calculation-engine.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const semantic = read("baseline/semantic-snapshot.json");
const moData = {
  ...read("app/mo-data.json"),
  ...read("app/operational-mo.json"),
  ...read("app/organization-status.json"),
  ...read("app/physician-metrics.json").datasets,
};
const physicianMetrics = read("app/physician-metrics.json");
const moDetails = read("app/mo-details.json");
const moDetailOids = read("app/mo-detail-oids.json");
const preventiveSemdAudit = read("app/preventive-semd-audit.json");
const preventiveChildOids = new Set(
  preventiveSemdAudit.rows.filter((row) => row.child).map((row) => row.oid),
);
const sourceBackedIndicatorIds = new Set([
  "egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp",
]);
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
  !isTechnicalRow(row.name) &&
  !isExcludedFromIndicators(row.name) &&
  (!(id === "tmkMaxCount" || id === "elnMaxCount") || !isMaxProfileInapplicable(row.name));

const staticIndicators = Object.entries(semantic.regionalCards).map(([id, card]) => ({
  id,
  group: "snapshot",
  name: id,
  fact: card.fact,
  plan: card.plan,
  unit: id === "tmkMax" || id === "elnMax" || id === "visitMax" ? "" : "%",
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
  preventiveChildOids,
  blockedIndicatorIds: new Set(),
  sourceBackedIndicatorIds,
  sourceQuantityNouns,
  reportingLabel: "август 2026",
  includeDatasetRow,
});

const regional = {};
for (const id of Object.keys(semantic.regionalCards)) {
  const item = runtime.byId[id];
  regional[id] = {
    fact: item.fact,
    plan: item.plan,
    date: item.date,
    quantity: item.quantity ?? null,
    numerator: item.calculation?.numerator ?? null,
    denominator: item.calculation?.denominator ?? null,
    method: item.calculation?.method ?? null,
    source: item.calculation?.source ?? null,
  };
}
const physician = Object.fromEntries(
  Object.keys(physicianMetrics.datasets).map((id) => {
    const item = runtime.byId[id];
    return [id, {
      fact: item.fact,
      plan: item.plan,
      date: item.date,
      numerator: item.calculation?.numerator ?? null,
      denominator: item.calculation?.denominator ?? null,
      method: item.calculation?.method ?? null,
    }];
  }),
);
const divergences = Object.entries(regional)
  .map(([id, actual]) => {
    const approved = semantic.regionalCards[id];
    const delta = actual.fact - approved.fact;
    return {
      id,
      approvedStaticFact: approved.fact,
      runtimeFact: actual.fact,
      roundedApproved: Number(approved.fact.toFixed(2)),
      roundedRuntime: Number(actual.fact.toFixed(2)),
      delta,
    };
  })
  .filter((row) => row.roundedApproved !== row.roundedRuntime);

const allIndicators = Object.fromEntries(
  Object.entries(runtime.allById)
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([id, item]) => [id, {
      fact: item.fact,
      plan: item.plan ?? null,
      date: item.date ?? null,
      previous: item.previous ?? null,
      trend: item.trend ?? null,
      quantity: item.quantity ?? null,
      numerator: item.calculation?.numerator ?? null,
      denominator: item.calculation?.denominator ?? null,
      method: item.calculation?.method ?? null,
      source: item.calculation?.source ?? null,
    }]),
);

const payload = {
  schemaVersion: 1,
  baselineVersion: "4.6.0",
  rule: "Snapshot reproduces the pre-stage5 v4.6.0 runtime calculation order; it is an equivalence gate, not a new approved methodology.",
  allIndicators,
  regional,
  physician,
  approvedStaticVsRuntimeDivergences: divergences,
};
const stable = JSON.stringify(payload);
payload.sha256 = crypto.createHash("sha256").update(stable).digest("hex");
fs.writeFileSync("baseline/calculation-runtime-snapshot.json", JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify({ allIndicators: Object.keys(allIndicators).length, regional: Object.keys(regional).length, physician: Object.keys(physician).length, divergences }, null, 2));
