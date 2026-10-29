import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const periodViews = JSON.parse(fs.readFileSync(new URL("../app/max-period-views.json", import.meta.url), "utf8"));

test("MAX comparison snapshots use like-for-like periods and preserve missing rows", () => {
  assert.deepEqual([periodViews.operational.previousDate, periodViews.operational.date], ["26.10.2026", "29.10.2026"]);
  assert.deepEqual([periodViews.cumulative.previousDate, periodViews.cumulative.date], ["25.10.2026", "28.10.2026"]);
  assert.deepEqual([periodViews.operational.metrics.tmk.previousPlannedMoFact, periodViews.operational.metrics.tmk.plannedMoFact], [11755, 13789]);
  assert.deepEqual([periodViews.operational.metrics.eln.previousPlannedMoFact, periodViews.operational.metrics.eln.plannedMoFact], [9683, 11077]);
  assert.deepEqual([periodViews.cumulative.metrics.tmk.previousPlannedMoFact, periodViews.cumulative.metrics.tmk.plannedMoFact], [68026, 70140]);
  assert.deepEqual([periodViews.cumulative.metrics.eln.previousPlannedMoFact, periodViews.cumulative.metrics.eln.plannedMoFact], [52219, 53621]);

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
  assert.deepEqual([cT.previous, cT.fact, cT.plan], [518, 523, 1024]);
  assert.deepEqual([cE.previous, cE.fact, cE.plan], [306, 310, 521]);
  assert.deepEqual([oT.previous, oT.fact, oT.plan], [29, 33, 102]);
  assert.deepEqual([oE.previous, oE.fact, oE.plan], [23, 27, 50]);
});
