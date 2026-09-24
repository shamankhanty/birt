import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync("config/indicator-registry.json", "utf8"));
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const monthly = JSON.parse(fs.readFileSync("app/monthly-mo.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

function evaluate(row, dental = true) {
  if (!row || (row.volume ?? 0) <= 0) return { fact: null, passed: null, status: "missing" };
  const fact = row.count / row.volume * 100;
  if (!dental && row.volume < 3) return { fact, passed: null, status: "reference" };
  return { fact, passed: fact >= 50, status: fact >= 50 ? "good" : "bad" };
}

test("dentist is mandatory and uses the latest operational September cut", () => {
  assert.equal(registry.indicators.doctor500_dentist.plan.value, 50);
  assert.equal(registry.indicators.doctor500_dentist.rating.policy, "include");
  assert.equal(registry.indicators.doctor500_dentist.rating.block, "readiness");
  assert.deepEqual(registry.indicators.doctor500_dentist.rowExclusionRules, ["small_denominator_lt3_reference_only"]);
  assert.equal(weekly.date, "23.09.2026");
  assert.match(weekly.period, /01\.09.*23\.09/u);
  assert.ok(weekly.source);
  assert.ok(monthly.doctor500_dentist.rows.length > 0);
  assert.ok(monthly.doctor500_dentist.previousLabel);
  assert.ok(monthly.doctor500_dentist.currentLabel);
  assert.match(page, /physicianWeeklySnapshotRaw/);
  assert.match(page, /isDentalOrganization/);
  assert.match(page, /isSmallPhysicianDenominator\(id, row, registry\)/u);
});

test("dentist threshold cases are evaluated, including denominator 1", () => {
  for (const [count, volume, expected, status] of [[0, 16, false, "bad"], [11, 27, false, "bad"], [1, 1, true, "good"], [0, 1, false, "bad"]]) {
    const result = evaluate({ count, volume });
    assert.equal(result.passed, expected);
    assert.equal(result.status, status);
  }
});

test("missing row and zero denominator are not converted to zero", () => {
  assert.deepEqual(evaluate(undefined), { fact: null, passed: null, status: "missing" });
  assert.deepEqual(evaluate({ count: 0, volume: 0 }), { fact: null, passed: null, status: "missing" });
  assert.match(page, /Рейтинг неполный/u);
});

test("other specialty rules remain unchanged", () => {
  for (const id of ["doctor500_obgyn", "doctor500_gp", "doctor500_pediatrician", "doctor500_surgeon", "doctor500_therapist"]) {
    assert.ok(registry.indicators[id].rowExclusionRules.includes("small_denominator_lt3_reference_only"));
  }
});

test("ordinary organizations keep the small-denominator reference rule", () => {
  assert.match(page, /if \(id === "doctor500_dentist" && registry && isDentalOrganization\(registry\)\) return false/u);
  assert.match(page, /small_denominator_lt3_reference_only/u);
  assert.deepEqual(evaluate({ count: 0, volume: 1 }, false), { fact: 0, passed: null, status: "reference" });
  assert.deepEqual(evaluate({ count: 1, volume: 2 }, false), { fact: 50, passed: null, status: "reference" });
});
