import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync("config/indicator-registry.json", "utf8"));
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const operational = JSON.parse(fs.readFileSync("app/operational-mo.json", "utf8"));
const status = JSON.parse(fs.readFileSync("app/organization-status.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8")).datasets;
const page = fs.readFileSync("app/page.tsx", "utf8");

const runtimeDatasetIds = new Set([
  ...Object.keys(mo),
  ...Object.keys(operational),
  ...Object.keys(status),
  ...Object.keys(physicians),
]);
const staticIndicatorIds = [...page.matchAll(/\bid:\s*"([A-Za-z0-9_]+)"/g)]
  .map((m) => m[1])
  .filter((id) => !["organizationRating", "incident38"].includes(id));

test("indicator registry is the active runtime metadata source in stage 6", () => {
  assert.equal(registry.status, "active");
  assert.equal(registry.runtimeIntegration, true);
  assert.match(page, /indicator-registry\.json/);
  assert.match(page, /createIndicatorRegistryRuntime/);
  assert.equal(page.includes("const excludedRatingIds = new Set"), false);
  assert.equal(page.includes("const excludedPriorityIds = new Set"), false);
  assert.equal(page.includes("care: 0.7"), false);
  assert.match(page, /indicatorRegistry\.affectsHearingPriority\(id\)/);
  assert.match(page, /indicatorRegistry\.hasRowExclusion/);
});

test("registry covers every internal runtime dataset and regional indicator", () => {
  const expected = new Set([...runtimeDatasetIds, ...staticIndicatorIds]);
  for (const id of expected) assert.ok(registry.indicators[id], `registry missing ${id}`);
});

test("registry mirrors plans, units and directions from current data files", () => {
  for (const source of [mo, operational, status, physicians]) {
    for (const [id, ds] of Object.entries(source)) {
      const item = registry.indicators[id];
      assert.ok(item, id);
      assert.equal(item.plan.value, ds.plan ?? null, `${id}: plan`);
      assert.equal(item.unit, ds.unit ?? null, `${id}: unit`);
      assert.equal(item.direction, ds.direction ?? "higher", `${id}: direction`);
    }
  }
});

test("approved 2026 preventive methodology is frozen in the registry", () => {
  const x = registry.indicators.semd228;
  assert.equal(x.plan.value, 95);
  assert.match(x.formula, /MAX\(СЭМД 122; СЭМД 228\)/);
  assert.match(x.formula, /01\.01\.2027/);
  assert.equal(x.period.kind, "cumulative");
  assert.equal(x.rating.baselineActive, true);
});

test("rating baseline exactly mirrors v4.6.0 August inclusion and weights", () => {
  assert.deepEqual(registry.rating.blocks, { care: 0.7, services: 0.2, readiness: 0.1 });
  const active = Object.entries(registry.indicators)
    .filter(([, item]) => item.rating.baselineActive)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(active, [
    "death",
    "doctor500_cardiologist",
    "doctor500_dentist",
    "doctor500_gp",
    "doctor500_obgyn",
    "doctor500_oncologist",
    "doctor500_ophthalmologist",
    "doctor500_pediatrician",
    "doctor500_surgeon",
    "doctor500_therapist",
    "doctorsAll",
    "doctorsLevel3",
    "hospital",
    "semd228",
    "tvspAmbulatory",
    "tvspDiagnostic",
    "tvspStationary",
  ]);
  assert.equal(registry.indicators.ambulatoryCase.rating.policy, "conditional");
  assert.equal(registry.indicators.tvspLaboratory.rating.policy, "exclude");
  assert.equal(registry.indicators.egpu2days.rating.policy, "exclude");
});

test("monthly physician metrics are identified as monthly and errors as lower-is-better", () => {
  for (const [id, item] of Object.entries(registry.indicators)) {
    if (id === "doctorsAll" || id === "doctorsLevel3" || id.startsWith("doctor500_")) {
      assert.equal(item.period.kind, "monthly", id);
    }
  }
  assert.equal(registry.indicators.errors.direction, "lower");
  assert.equal(registry.indicators.shortInput.direction, "lower");
});
