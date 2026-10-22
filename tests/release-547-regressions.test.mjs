import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

test("500+ keeps September rating and exposes the October operational delta", () => {
  const september = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8")).datasets.doctor500_pediatrician.summary;
  const current = weekly.summary.doctor500_pediatrician;
  const previous = weekly.previousSummary.doctor500_pediatrician;
  assert.equal(september.fact, 833 / 1357 * 100);
  assert.deepEqual([current.numerator, current.denominator], [731, 1360]);
  assert.deepEqual([previous.numerator, previous.denominator], [664, 1359]);
  assert.equal(Number((current.fact - previous.fact).toFixed(2)), 4.89);
  assert.match(page, /physicianWeeklySnapshot\.previousSummary/u);
  assert.match(page, /dynamicsMode === "month"/u);
});

test("cumulative ratios use the previous numerator and denominator pair", () => {
  assert.deepEqual([mo.semd228.previousNumerator, mo.semd228.previousDenominator], [2004475, 2308095]);
  assert.equal(Number((mo.semd228.numerator / mo.semd228.denominator * 100).toFixed(2)), 87.5);
  assert.equal(Number((mo.semd228.previousNumerator / mo.semd228.previousDenominator * 100).toFixed(2)), 86.85);
  assert.equal(Number((mo.ambulatoryCase.numerator / mo.ambulatoryCase.denominator * 100).toFixed(2)), 91.33);
  assert.deepEqual([mo.hospital.numerator, mo.hospital.denominator], [695665, 773909]);
  assert.match(page, /componentPreviousFact/u);
});

test("heard organizations retain metric snapshots without comparing obsolete aggregate formulas", () => {
  assert.match(page, /snapshotPotential/u);
  assert.match(page, /potentialChange/u);
  assert.match(page, /исторический приоритет не пересчитывается задним числом/u);
});
