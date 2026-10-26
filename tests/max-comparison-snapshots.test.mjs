import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const periodViews = JSON.parse(fs.readFileSync(new URL("../app/max-period-views.json", import.meta.url), "utf8"));

test("MAX comparison snapshots use like-for-like periods and preserve missing rows", () => {
  assert.deepEqual([periodViews.operational.previousDate, periodViews.operational.date], ["22.10.2026", "26.10.2026"]);
  assert.deepEqual([periodViews.cumulative.previousDate, periodViews.cumulative.date], ["22.10.2026", "25.10.2026"]);
  assert.deepEqual([periodViews.operational.metrics.tmk.previousPlannedMoFact, periodViews.operational.metrics.tmk.plannedMoFact], [10229, 11755]);
  assert.deepEqual([periodViews.operational.metrics.eln.previousPlannedMoFact, periodViews.operational.metrics.eln.plannedMoFact], [8572, 9683]);
  assert.deepEqual([periodViews.cumulative.metrics.tmk.previousPlannedMoFact, periodViews.cumulative.metrics.tmk.plannedMoFact], [66483, 68026]);
  assert.deepEqual([periodViews.cumulative.metrics.eln.previousPlannedMoFact, periodViews.cumulative.metrics.eln.plannedMoFact], [51388, 52219]);

  for (const slice of [periodViews.operational, periodViews.cumulative]) {
    for (const metric of [slice.metrics.tmk, slice.metrics.eln]) {
      assert.equal(metric.rows.length, 85);
      assert.equal(metric.rows.filter((row) => row.previous === null).length, 1);
      assert.equal(metric.rows.reduce((sum, row) => sum + (row.previous ?? 0), 0), metric.previousPlannedMoFact);
    }
  }
});

test("Agriz keeps independent previous, current, and plan values", () => {
  const oid = "1.2.643.5.1.13.13.12.2.16.1088";
  const cT = periodViews.cumulative.metrics.tmk.rows.find((row) => row.oid === oid);
  const cE = periodViews.cumulative.metrics.eln.rows.find((row) => row.oid === oid);
  const oT = periodViews.operational.metrics.tmk.rows.find((row) => row.oid === oid);
  const oE = periodViews.operational.metrics.eln.rows.find((row) => row.oid === oid);
  assert.deepEqual([cT.previous, cT.fact, cT.plan], [511, 518, 1024]);
  assert.deepEqual([cE.previous, cE.fact, cE.plan], [302, 306, 521]);
  assert.deepEqual([oT.previous, oT.fact, oT.plan], [22, 29, 102]);
  assert.deepEqual([oE.previous, oE.fact, oE.plan], [18, 23, 50]);
});
