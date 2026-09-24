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
  for (const metric of sourceBacked) {
    const dataset = mo[metric];
    assert.equal(dataset.numerator, sum(metric, "registered"), `${metric} current numerator`);
    assert.equal(dataset.denominator, sum(metric, "volume"), `${metric} current denominator`);
    if (!("previousNumerator" in dataset) || !("previousDenominator" in dataset)) continue;
    assert.equal(typeof dataset.previousNumerator, "number", `${metric} previous numerator`);
    assert.equal(typeof dataset.previousDenominator, "number", `${metric} previous denominator`);
    assert.ok(dataset.previousPeriod && dataset.period, `${metric} periods are present`);
    const periodDate = value => new Date(value.split(/[–-]/u).at(-1).split(".").reverse().join("-"));
    assert.ok(periodDate(dataset.previousPeriod) < periodDate(dataset.period), `${metric} previous period precedes current period`);
    assert.equal(dataset.numerator - dataset.previousNumerator, sum(metric, "registered") - dataset.previousNumerator, `${metric} numerator delta`);
    assert.equal(dataset.denominator - dataset.previousDenominator, sum(metric, "volume") - dataset.previousDenominator, `${metric} denominator delta`);
  }
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


test("UI derives previous cumulative regional fact from preserved components", () => {
  assert.match(page, /componentPreviousFact/u);
  assert.match(page, /previousRegionalComponents\.numerator \/ previousRegionalComponents\.denominator/u);
  assert.match(page, /effectiveRegionalPrevious/u);
});
