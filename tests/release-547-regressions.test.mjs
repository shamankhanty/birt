import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

test("500+ keeps August rating and exposes the September operational delta", () => {
  const august = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8")).datasets.doctor500_pediatrician.summary;
  const current = weekly.summary.doctor500_pediatrician;
  const previous = weekly.previousSummary.doctor500_pediatrician;
  assert.equal(august.fact, 50.18925056775171);
  assert.deepEqual([current.numerator, current.denominator], [613, 1339]);
  assert.deepEqual([previous.numerator, previous.denominator], [324, 1326]);
  assert.equal(Number((current.fact - previous.fact).toFixed(2)), 21.35);
  assert.match(page, /physicianWeeklySnapshot\.previousSummary/u);
  assert.match(page, /dynamicsMode === "month"/u);
});

test("cumulative ratios use the previous numerator and denominator pair", () => {
  assert.deepEqual([mo.semd228.previousNumerator, mo.semd228.previousDenominator], [1565447, 2109624]);
  assert.equal(Number((mo.semd228.numerator / mo.semd228.denominator * 100).toFixed(2)), 75.44);
  assert.equal(Number((mo.semd228.previousNumerator / mo.semd228.previousDenominator * 100).toFixed(2)), 74.21);
  assert.equal(Number((mo.ambulatoryCase.numerator / mo.ambulatoryCase.denominator * 100).toFixed(2)), 89.64);
  assert.deepEqual([mo.hospital.numerator, mo.hospital.denominator], [587513, 682229]);
  assert.match(page, /componentPreviousFact/u);
});

test("hearing rows retain snapshot and current potential separately", () => {
  assert.match(page, /snapshotPotential/u);
  assert.match(page, /potentialChange/u);
  assert.match(page, /на дату заслушивания/u);
});
