import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/page.tsx", "utf8");
const adapters = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const details = JSON.parse(fs.readFileSync("app/mo-details.json", "utf8"));
const sourceBacked = ["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"];
const sum = (metric, field) => Object.values(details[metric] ?? {}).reduce((total, row) => total + Number(row?.[field] ?? 0), 0);

test("all source-backed cumulative shares persist current numerator and denominator", () => {
  for (const metric of sourceBacked) {
    assert.equal(mo[metric].numerator, sum(metric, "registered"), `${metric} numerator`);
    assert.equal(mo[metric].denominator, sum(metric, "volume"), `${metric} denominator`);
  }
});

test("confirmed previous components expose the real cumulative movements", () => {
  assert.deepEqual([mo.semd228.previousNumerator, mo.semd228.previousDenominator], [1557278, 2036859]);
  assert.deepEqual([mo.ambulatoryCase.previousNumerator, mo.ambulatoryCase.previousDenominator], [9549272, 10948601]);
  assert.deepEqual([mo.smp.previousNumerator, mo.smp.previousDenominator], [576237, 624216]);
  assert.equal(mo.semd228.numerator - mo.semd228.previousNumerator, -29683);
  assert.equal(mo.semd228.denominator - mo.semd228.previousDenominator, 32773);
});

test("indicator UI shows component dynamics only where the regional ratio is source-backed", () => {
  assert.match(page, /sourceBackedIndicatorIds\.has\(matrixMetric\)/u);
  assert.match(page, /previousNumerator/u);
  assert.match(page, /previousDenominator/u);
  assert.match(page, /числитель уменьшился/u);
  assert.match(page, /знаменатель уменьшился/u);
  assert.match(page, /компоненты предыдущего среза не сохранены/u);
  assert.match(page, /selectedDataset\.comparisonReset\s*\?\s*null/u);
});

test("pipeline carries component baselines forward without reconstructing missing values", () => {
  assert.match(adapters, /def previous_summary_metadata\(base: dict, end: date\)/u);
  assert.match(adapters, /never reconstructed from the percentage alone/u);
  assert.match(adapters, /"previousNumerator": base\.get\("previousNumerator"\) if same_cut else base\.get\("numerator"\)/u);
  assert.match(adapters, /corrected_baseline_exists/u);
  assert.match(adapters, /comparison_reset = base\.get\("comparisonReset", True\) if same_cut else not corrected_baseline_exists/u);
});
