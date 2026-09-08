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

test("weekly EPL comparison uses official totals and complete current hierarchy", () => {
  assert.equal(weekly.previous.period, "17.08–23.08.2026");
  assert.equal(weekly.current.period, "24.08–30.08.2026");
  assert.equal(weekly.previous.rows.length, 126);
  assert.equal(weekly.current.rows.length, 126);
  assert.deepEqual(
    [weekly.previous.systemSummary.vehicles, weekly.previous.systemSummary.vehiclesWithMovement, weekly.previous.systemSummary.vehiclesWithWaybills],
    [1770, 515, 664],
  );
  assert.deepEqual(
    [weekly.current.detail.vehicles, weekly.current.detail.vehiclesWithMovement, weekly.current.detail.waybills, weekly.current.detail.driversWithWaybills],
    [1724, 699, 3935, 1434],
  );
  assert.equal(weekly.current.systemSummary.vehiclesWithMovement, 699);
  assert.equal(weekly.current.systemSummary.vehiclesWithMovement, weekly.current.detail.vehiclesWithMovement);
  assert.deepEqual(weekly.previous.rows.map(row => row.sourceNumber), weekly.current.rows.map(row => row.sourceNumber));
  assert.equal(weekly.current.rows.reduce((sum, row) => sum + Math.max(1, row.components?.length ?? 0), 0), 171);
  const kazan = weekly.current.rows.find(row => row.sourceNumber === 110);
  assert.equal(kazan.name, "ССМП Казани (подстанции №1–9 и общая строка)");
  assert.deepEqual([kazan.components.length, kazan.vehicles, kazan.moved], [10, 126, 55]);
  assert.match(weekly.comparisonRule, /по номеру группы/);
});
