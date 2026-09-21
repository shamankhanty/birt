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
  const parsePeriod = period => period.split("–").map(value => {
    const [day, month, year] = value.split(".").map(Number);
    return Date.UTC(year, month - 1, day);
  });
  const [previousStart, previousEnd] = parsePeriod(weekly.previous.period);
  const [currentStart, currentEnd] = parsePeriod(weekly.current.period);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(previousEnd - previousStart, 6 * day);
  assert.equal(currentEnd - currentStart, 6 * day);
  assert.equal(currentStart - previousEnd, day);
  assert.equal(weekly.previous.rows.length, 126);
  assert.equal(weekly.current.rows.length, 126);
  for (const cut of [weekly.previous, weekly.current]) {
    assert.equal(cut.systemSummary.organizations, cut.rows.length);
    assert.ok(cut.systemSummary.vehicles >= cut.systemSummary.vehiclesWithMovement);
    assert.ok(cut.systemSummary.vehicles >= cut.systemSummary.vehiclesWithWaybills);
  }
  assert.equal(weekly.current.detail.vehicles, weekly.current.rows.reduce((sum, row) => sum + row.vehicles, 0));
  assert.equal(weekly.current.detail.vehiclesWithMovement, weekly.current.rows.reduce((sum, row) => sum + row.moved, 0));
  assert.equal(weekly.current.detail.waybills, weekly.current.rows.reduce((sum, row) => sum + row.waybills, 0));
  assert.deepEqual(weekly.previous.rows.map(row => row.sourceNumber), weekly.current.rows.map(row => row.sourceNumber));
  const kazan = weekly.current.rows.find(row => row.sourceNumber === 110);
  assert.ok(kazan);
  assert.equal(kazan.name, "Станции скорой медицинской помощи г. Казани Подстанция № 1");
  assert.ok(kazan.vehicles >= kazan.moved);
  assert.ok(kazan.waybills >= 0);
  assert.match(weekly.comparisonRule, /по номеру группы/);
});
