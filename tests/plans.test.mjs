import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const status = JSON.parse(await readFile(new URL("../app/organization-status.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../config/indicator-registry.json", import.meta.url), "utf8"));
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("TMK protocol transfer has a 100 percent canonical plan", () => {
  assert.equal(registry.indicators.tmkRemd.plan.value, 100);
  assert.equal(status.tmkRemd.plan, 100);
  assert.match(page, /indicatorRegistry\.applyToDatasetMap/u);
});

test("MAX operational facts use confirmed annual plans from the canonical registry", () => {
  assert.equal(registry.indicators.tmkMax.plan.value, 193000);
  assert.equal(registry.indicators.elnMax.plan.value, 99000);
  assert.equal(registry.indicators.visitMax.plan.value, 654000);
  assert.equal(registry.indicators.tmkMax.plan.period, "план 2026");
  assert.equal(registry.indicators.elnMax.plan.period, "план 2026");
  assert.equal(registry.indicators.visitMax.plan.period, "план 2026");
});

test("static UI indicator definitions no longer duplicate numeric plans", () => {
  const block = page.slice(page.indexOf("const baselineIndicators"), page.indexOf("const indicators =", page.indexOf("const baselineIndicators")));
  assert.equal(/plan:\s*\d/u.test(block), false);
  assert.equal(/reverse:\s*true/u.test(block), false);
  assert.equal(/planPeriod:/u.test(block), false);
});

test("ELMK planned organizations have unique OIDs", () => {
  const rows = status.elmk.rows;
  assert.equal(rows.length, 73);
  assert.equal(new Set(rows.map(row => row.oid)).size, 73);
  assert.equal(rows.some(row => row.oid === "1.2.643.5.1.13.13.12.2.16.1079"), false);
  assert.equal(status.elmk.numerator, 73);
  assert.equal(status.elmk.denominator, 73);
  assert.equal(status.elmk.fact, 100);
  assert.equal(status.elmk.comparisonReset, false);
  const gp18 = rows.find(row => row.name === "ГОРОДСКАЯ ПОЛИКЛИНИКА №18 г. Казань");
  assert.equal(gp18?.oid, "1.2.643.5.1.13.13.12.2.16.1080");
  assert.equal(gp18?.count, 110);
  assert.equal(gp18?.fact, 100);
});

test("ELMK methodology excludes MKDC after license revocation", () => {
  const elmk = registry.indicators.elmk;
  assert.match(elmk.denominator, /73 применимые/u);
  assert.match(elmk.exclusions.join(" "), /1\.2\.643\.5\.1\.13\.13\.12\.2\.16\.1079/u);
  assert.match(elmk.notes, /73 из 73/u);
});
