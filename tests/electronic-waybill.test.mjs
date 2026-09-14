import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../app/electronic-waybill.json", import.meta.url), "utf8"));
const weekly = JSON.parse(await readFile(new URL("../app/electronic-waybill-weekly.json", import.meta.url), "utf8"));

test("electronic waybill detail keeps all source organizations", () => {
  assert.equal(data.rows.length, 126);
  assert.equal(new Set(data.rows.map(row => row.name)).size, 126);
  assert.equal(data.detail.organizations, 126);
});

test("electronic waybill summary percentages reproduce the source totals", () => {
  assert.equal(data.summary.vehiclesWithWaybillsShare, data.summary.vehiclesWithWaybills / data.summary.vehicles * 100);
  assert.equal(data.summary.vehiclesWithMovementShare, data.summary.vehiclesWithMovement / data.summary.vehicles * 100);
  assert.equal(data.summary.ambulanceVehiclesWithWaybillsShare, data.summary.ambulanceVehiclesWithWaybills / data.summary.ambulanceVehicles * 100);
});

test("electronic waybill detail totals are preserved and source differences stay visible", () => {
  assert.equal(data.rows.reduce((sum, row) => sum + row.waybills, 0), 9070);
  assert.equal(data.rows.reduce((sum, row) => sum + row.driversWithWaybills, 0), 852);
  assert.equal(data.quality.length, 3);
  assert.ok(data.quality.every(item => item.difference !== 0));
});

test("weekly EPL comparison uses the latest two comparable weeks", () => {
  assert.equal(weekly.previous.period, "31.08.2026–06.09.2026");
  assert.equal(weekly.current.period, "07.09.2026–13.09.2026");
  assert.equal(weekly.previous.rows.length, 126);
  assert.equal(weekly.current.rows.length, 126);
  assert.deepEqual(
    [weekly.previous.systemSummary.vehicles, weekly.previous.systemSummary.vehiclesWithMovement, weekly.previous.systemSummary.vehiclesWithWaybills],
    [1725, 804, 1016],
  );
  assert.deepEqual(
    [weekly.current.systemSummary.vehicles, weekly.current.systemSummary.vehiclesWithMovement, weekly.current.systemSummary.vehiclesWithWaybills],
    [1722, 809, 1002],
  );
  assert.deepEqual(
    [weekly.current.detail.vehicles, weekly.current.detail.vehiclesWithMovement, weekly.current.detail.waybills, weekly.current.detail.driversWithWaybills],
    [1458, 707, 3846, 1204],
  );
  assert.deepEqual(weekly.previous.rows.map(row => row.sourceNumber), weekly.current.rows.map(row => row.sourceNumber));
  const kazan = weekly.current.rows.find(row => row.sourceNumber === 110);
  assert.ok(kazan);
  assert.equal(kazan.name, "Станции скорой медицинской помощи г. Казани Подстанция № 1");
  assert.deepEqual([kazan.vehicles, kazan.moved, kazan.waybills], [32, 13, 96]);
  assert.match(weekly.comparisonRule, /по номеру группы/);
});
