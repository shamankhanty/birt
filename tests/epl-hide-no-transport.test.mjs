import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { excludeWaybillGroupsWithoutTransport } from "../lib/electronic-waybill-scope.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const october = read("app/electronic-waybill.json");
const weekly = read("app/electronic-waybill-weekly.json");
const zeroSourceNumbers = [75, 118];

test("ЭПЛ: only the two confirmed no-transport groups are hidden in October and November", () => {
  for (const slice of [october, weekly.current]) {
    assert.equal(slice.rows.length, 123, "Accepted source remains complete");
    const zero = slice.rows.filter(r => r.vehicles === 0);
    assert.deepEqual(zero.map(r => r.sourceNumber).sort((a,b)=>a-b), zeroSourceNumbers);
    const visible = excludeWaybillGroupsWithoutTransport(slice.rows);
    assert.equal(visible.length, 121);
    assert.ok(visible.every(r => r.vehicles > 0));
    assert.ok(visible.some(r => r.vehicles > 0 && r.moved === 0),
      "МО с транспортом без движения остаются под контролем");
    assert.ok(!visible.some(r => zeroSourceNumbers.includes(r.sourceNumber)));
    assert.ok(zero.every(r => r.moved === 0 && r.waybills === 0));
    assert.equal(visible.reduce((s,r)=>s+r.vehicles,0),slice.detail.vehicles,
      "0 ТС do not change fleet totals");
    assert.equal(visible.reduce((s,r)=>s+r.moved,0),slice.detail.vehiclesWithMovement);
    assert.equal(visible.reduce((s,r)=>s+r.waybills,0),slice.detail.waybills);
  }
});

test("ЭПЛ: organization/source perimeter and regional header totals remain authoritative", () => {
  assert.equal(october.summary.organizations,126);
  assert.equal(october.summary.vehicles,1693);
  assert.equal(weekly.current.systemSummary.organizations,126);
  assert.equal(weekly.current.systemSummary.vehicles,1691);
  assert.equal(october.detail.organizations,123);
  assert.equal(weekly.current.detail.organizations,123);
  assert.deepEqual(weekly.missingCurrentGroups,[39,40,41]);
  assert.equal(october.detail.zeroVehicleOrganizations,2);
  assert.equal(weekly.current.detail.zeroVehicleOrganizations,2);
  assert.equal(weekly.previous.rows.length,126,"Previous weeks are kept for comparison");
});

test("ЭПЛ: missing vehicle count is not silently treated as confirmed zero", () => {
  const rows = [
    {vehicles:0,name:"confirmed zero"},
    {vehicles:null,name:"missing"},
    {vehicles:undefined,name:"not supplied"},
    {vehicles:1,name:"has vehicle, no movement",moved:0},
  ];
  assert.deepEqual(excludeWaybillGroupsWithoutTransport(rows).map(r=>r.name),
    ["missing","not supplied","has vehicle, no movement"]);
  assert.equal(rows.length,4);
});

test("ЭПЛ: all view widgets use one filtered list; obsolete no-fleet selector is removed", () => {
  const ui = fs.readFileSync("app/page.tsx","utf8");
  assert.match(ui,/const waybillRows = useMemo\([\s\S]*?excludeWaybillGroupsWithoutTransport\(/);
  assert.match(ui,/const waybillZones = useMemo\(/);
  assert.match(ui,/const waybillSignals = useMemo\(/);
  assert.match(ui,/const visibleWaybillRows = useMemo\(/);
  assert.match(ui,/\{visibleWaybillRows\.length\} из \{waybillRows\.length\}/);
  assert.match(ui,/<h2>МО с транспортом<\/h2>/);
  assert.match(ui,/В детализации скрыты только группы с 0 ТС/);
  assert.doesNotMatch(ui,/setWaybillStatus\("noFleet"\)/);
  assert.doesNotMatch(ui,/<option value="noFleet">/);
  assert.match(ui,/electronicWaybillWeekly\.current\.systemSummary\.vehiclesWithMovement/);
});
