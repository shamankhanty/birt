import fs from "node:fs";
import path from "node:path";
import { createIndicatorRegistryRuntime } from "../lib/indicator-registry.js";
import { datasetBelongsToReportingMonth, resolveReportingPeriods } from "../lib/period-engine.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const registry = read("config/indicator-registry.json");
const baseline = read("baseline/indicator-metadata-snapshot.json");
const runtime = createIndicatorRegistryRuntime(registry);
const mismatches = [];
const push = (scope, id, field, expected, actual) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    mismatches.push({ scope, id, field, expected, actual });
  }
};

const validation = runtime.validate();
if (!validation.ok) {
  for (const issue of validation.issues) mismatches.push({ scope: "registry", id: issue, field: "schema", expected: "valid", actual: "invalid" });
}

for (const [id, expected] of Object.entries(baseline.registryMetadata)) {
  const actual = runtime.metadata(id);
  for (const field of ["plan", "planPeriod", "direction", "periodKind", "ratingPolicy", "ratingActive", "ratingBlock", "exclusions"]) {
    push("metadata", id, field, expected[field], actual[field]);
  }
}

for (const [id, expected] of Object.entries(baseline.staticIndicators)) {
  push("static", id, "plan", expected.plan, runtime.plan(id));
  push("static", id, "direction", expected.direction, runtime.direction(id));
  push("static", id, "planPeriod", expected.planPeriod, runtime.planPeriod(id));
}

const sourceMaps = {
  "app/mo-data.json": read("app/mo-data.json"),
  "app/operational-mo.json": read("app/operational-mo.json"),
  "app/organization-status.json": read("app/organization-status.json"),
  "app/physician-metrics.json": read("app/physician-metrics.json").datasets,
};
for (const [id, expected] of Object.entries(baseline.datasetMetadata)) {
  const source = sourceMaps[expected.source]?.[id];
  if (!source) {
    mismatches.push({ scope: "dataset", id, field: "source", expected: expected.source, actual: null });
    continue;
  }
  const applied = runtime.applyToDataset(id, source);
  push("dataset", id, "plan", expected.plan, applied.plan ?? null);
  push("dataset", id, "direction", expected.direction, applied.direction ?? "higher");
}

for (const [block, expected] of Object.entries(baseline.rating.weights)) {
  push("rating", block, "weight", expected, runtime.ratingWeight(block));
}
for (const [id, expected] of Object.entries(baseline.rating.blocks)) {
  push("rating", id, "block", expected, runtime.ratingBlock(id));
}

const mo = runtime.applyToDatasetMap(read("app/mo-data.json"));
const operational = runtime.applyToDatasetMap(read("app/operational-mo.json"));
const status = runtime.applyToDatasetMap(read("app/organization-status.json"));
const physicianRaw = read("app/physician-metrics.json");
const physicians = {
  ...physicianRaw,
  datasets: runtime.applyToDatasetMap(physicianRaw.datasets),
};
const merged = { ...mo, ...operational, ...status, ...physicians.datasets };
const monthlyRaw = read("app/monthly-mo.json");
const monthlyRuntime = monthlyRaw;
const reporting = resolveReportingPeriods({
  monthlyDatasets: monthlyRuntime,
  datasets: Object.values(merged),
  physicianMetrics: physicians,
});
const eligible = Object.entries(monthlyRuntime)
  .filter(([id, dataset]) =>
    dataset.unit === "%" &&
    datasetBelongsToReportingMonth(dataset, reporting.latestFullMonth) &&
    runtime.plan(id, merged[id]?.plan ?? null) !== null &&
    runtime.canEnterRating(id),
  )
  .map(([id]) => id)
  .sort();
push("rating", "activeIds", "ids", baseline.rating.activeIds, eligible);

const result = {
  status: mismatches.length ? "FAIL" : "PASS",
  baselineVersion: baseline.baselineVersion,
  registrySchemaVersion: registry.schemaVersion,
  runtimeIntegration: registry.runtimeIntegration,
  indicatorsChecked: Object.keys(baseline.registryMetadata).length,
  datasetMetadataChecked: Object.keys(baseline.datasetMetadata).length,
  staticIndicatorsChecked: Object.keys(baseline.staticIndicators).length,
  latestFullMonth: reporting.latestFullMonth.label,
  previousFullMonth: reporting.previousFullMonth.label,
  ratingIndicators: eligible.length,
  mismatches,
};
fs.mkdirSync(path.join(ROOT, "validation"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "validation/indicator-metadata-equivalence.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (mismatches.length) process.exitCode = 1;
