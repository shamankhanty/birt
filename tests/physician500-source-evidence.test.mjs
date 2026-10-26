import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const report = JSON.parse(fs.readFileSync("docs/physician500-reconciliation-20261024.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));

test("primary workbook audit covers every source MO and all nine 500+ specialties", () => {
  assert.equal(report.issue, "https://github.com/shamankhanty/birt/issues/100");
  assert.match(report.sourceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.coverage.medicalOrganizationsInWorkbook, 124);
  assert.equal(report.coverage.medicalOrganizationsWithSpecialtyRows, 112);
  assert.equal(report.coverage.medicalOrganizationsOutsideSpecialtySource, 12);
  assert.equal(report.coverage.specialties, 9);
  assert.equal(report.coverage.checks, 718);
  assert.equal(report.checks.length, 718);
  assert.deepEqual(report.statusSummary, { PASS: 376, WARN: 342, FAIL: 0 });
  assert.equal(report.regionalReconciliation.length, 9);
  assert.ok(report.regionalReconciliation.every((item) => item.status === "PASS"));
});

test("every source aggregate is identical to the current dashboard snapshot", () => {
  assert.equal(snapshot.date, report.dashboardDate);
  assert.equal(snapshot.period, report.period);
  for (const row of report.checks) {
    assert.equal(row.sourceNumerator, row.dashboardNumerator, `${row.metric}/${row.moOid} numerator`);
    assert.equal(row.sourceDenominator, row.dashboardDenominator, `${row.metric}/${row.moOid} denominator`);
    assert.notEqual(row.status, "FAIL", `${row.metric}/${row.moOid} failed`);
  }
});

test("no-source organizations remain explicit exclusions rather than synthetic zeros", () => {
  assert.equal(report.outsideSpecialtyScope.length, 12);
  assert.ok(report.outsideSpecialtyScope.every((item) => item.status === "NOT_IN_SPECIALTY_SOURCE"));
  assert.ok(report.outsideSpecialtyScope.every((item) => /не заменено нулём/u.test(item.reason)));
});

test("Sabinsky dental control keeps aggregate 3/5 separate from the 2/5 detail diagnostic", () => {
  const sabin = report.sabinDentalControl;
  assert.equal(sabin.status, "PASS");
  assert.equal(sabin.sourceNumerator, 3);
  assert.equal(sabin.sourceDenominator, 5);
  assert.equal(sabin.confirmedNumeratorNoSum, 2);
  assert.equal(sabin.confirmedDenominatorByEligibleWorkerOid, 5);
  assert.equal(sabin.includedWorkers.length, 5);
  assert.equal(sabin.excludedWorkers.length, 4);
  assert.match(sabin.preliminary46Error, /стоматологов-хирургов/u);
  assert.match(sabin.preliminary46Error, /нулём СЭМД/u);
});
