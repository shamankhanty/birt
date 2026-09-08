import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createIndicatorRegistryRuntime } from "../lib/indicator-registry.js";
import { inferPeriodKind } from "../lib/period-engine.js";

const registry = JSON.parse(fs.readFileSync("config/indicator-registry.json", "utf8"));
const baseline = JSON.parse(fs.readFileSync("baseline/indicator-metadata-snapshot.json", "utf8"));
const runtime = createIndicatorRegistryRuntime(registry);

test("runtime registry schema is valid and rating weights sum to 1", () => {
  assert.deepEqual(runtime.validate(), { ok: true, issues: [] });
  assert.ok(Math.abs(runtime.ratingWeight("care") + runtime.ratingWeight("services") + runtime.ratingWeight("readiness") - 1) < 1e-12);
});

test("runtime metadata exactly matches frozen stage-5 metadata", () => {
  for (const [id, expected] of Object.entries(baseline.registryMetadata)) {
    const actual = runtime.metadata(id);
    for (const field of ["plan", "planPeriod", "direction", "periodKind", "ratingPolicy", "ratingActive", "ratingBlock", "exclusions"]) {
      assert.deepEqual(actual[field], expected[field], `${id}:${field}`);
    }
  }
});

test("registry overrides a stale plan in a source dataset", () => {
  const stale = { name: "test", plan: 999, unit: "%", rows: [] };
  const applied = runtime.applyToDataset("semd228", stale);
  assert.equal(applied.plan, 95);
  assert.equal(stale.plan, 999);
});

test("registry overrides evaluation direction without mutating the source", () => {
  const stale = { name: "test", plan: 10, direction: undefined, rows: [] };
  const applied = runtime.applyToDataset("errors", stale);
  assert.equal(applied.direction, "lower");
  assert.equal(stale.direction, undefined);
});

test("higher-is-better datasets remain behaviorally identical", () => {
  const source = { name: "test", plan: 1, unit: "%", rows: [] };
  const applied = runtime.applyToDataset("hospital", source);
  assert.equal(applied.plan, 95);
  assert.equal(applied.direction ?? "higher", "higher");
});

test("registry period kind is accepted explicitly by the period engine", () => {
  assert.equal(inferPeriodKind({ period: "август 2026", periodKind: runtime.periodKind("doctorsAll") }), "monthly");
  assert.equal(inferPeriodKind({ period: "01.01–31.08.2026", periodKind: runtime.periodKind("hospital") }), "cumulative");
  assert.equal(inferPeriodKind({ period: "на 07.09.2026", periodKind: runtime.periodKind("tmkMax") }), "operational");
});

test("rating policies distinguish explicit exclusion from conditional entry", () => {
  assert.equal(runtime.canEnterRating("death"), true);
  assert.equal(runtime.canEnterRating("ambulatoryCase"), true);
  assert.equal(runtime.canEnterRating("birth"), false);
  assert.equal(runtime.canEnterRating("tvspLaboratory"), false);
});

test("indicator-specific exclusions are exposed from one source", () => {
  assert.ok(runtime.exclusions("semd228").some((x) => x.includes("Ижевск")));
  assert.ok(runtime.exclusions("tmkMaxCount").some((x) => x.includes("РКПД")));
  assert.deepEqual(runtime.exclusions("death"), []);
});

test("all 38 indicator ids are addressable by runtime metadata", () => {
  assert.equal(Object.keys(runtime.indicators).length, 38);
  for (const id of Object.keys(runtime.indicators)) assert.equal(runtime.metadata(id).id, id);
});

test("hearing-priority policy is centralized and matches baseline v4.6.0", () => {
  const excluded = Object.keys(runtime.indicators)
    .filter((id) => !runtime.affectsHearingPriority(id))
    .sort();
  assert.deepEqual(excluded, [
    "birth",
    "egpu",
    "egpu2days",
    "elnMaxCount",
    "errors",
    "fapSemdCount",
    "hospitalCount",
    "shortInput",
    "shortInputAmb",
    "shortInputHosp",
    "tmkMaxCount",
  ]);
  assert.equal(runtime.affectsHearingPriority("hospital"), true);
});

test("row-level special applicability rules are centralized", () => {
  assert.deepEqual(runtime.rowExclusionRules("tmkMaxCount"), ["max_profile_inapplicable"]);
  assert.deepEqual(runtime.rowExclusionRules("elnMaxCount"), ["max_profile_inapplicable"]);
  for (const id of Object.keys(runtime.indicators).filter((id) => id.startsWith("doctor500_"))) {
    assert.equal(runtime.hasRowExclusion(id, "small_denominator_lt3_reference_only"), true, id);
  }
  assert.deepEqual(runtime.rowExclusionRules("hospital"), []);
});
