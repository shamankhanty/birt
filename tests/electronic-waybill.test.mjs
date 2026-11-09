import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { excludeZeroFleetOrganizations } from "../lib/epl-display-scope.js";

const read = async path => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const data = await read("app/electronic-waybill.json");
const weekly = await read("app/electronic-waybill-weekly.json");
const octSource = await read("docs/waybill/epl-source-202610.json");
const novSource = await read("docs/waybill/epl-source-20261102-08.json");
const fields = ["vehicles","ambulanceVehicles","otherVehicles","moved","drivers","mechanics","medics","waybills","ambulanceWaybills","otherWaybills","driversWithWaybills"];
const validNumbers = Array.from({length:126},(_,i)=>i+1).filter(n=>![39,40,41].includes(n));
const parseRows = src => src.raw.split(";").map(line=>line.split(",").map(Number));
const detailTotals = src => fields.map((field,idx)=>parseRows(src).reduce((sum,r)=>sum+r[idx],0));

test("monthly October and weekly November are separate observed periods", () => {
  assert.equal(data.period,"01.10.2026–31.10.2026");
  assert.equal(weekly.previous.period,"26.10.2026–01.11.2026");
  assert.equal(weekly.current.period,"02.11.2026–08.11.2026");
  const d = period => period.split("–").map(value=>{
    const [day,month,year] = value.split(".").map(Number);
    return Date.UTC(year,month-1,day);
  });
  const [a,b] = d(weekly.previous.period),[c,e]=d(weekly.current.period);
  const day=86400000;
  assert.equal(b-a,6*day);assert.equal(e-c,6*day);assert.equal(c-b,day);
});

test("regional October summary is not replaced by organizational waybill counts",()=>{
  assert.equal(data.summary.organizations,126);
  assert.equal(data.summary.vehicles,1693);
  assert.equal(data.summary.vehiclesWithWaybills,162);
  assert.equal(data.summary.vehiclesWithMovement,113);
  assert.equal(data.detail.waybills,608);
  assert.equal(data.detail.driversWithWaybills,176);
  assert.equal(data.summary.vehiclesWithWaybillsShare,162/1693*100);
  assert.equal(data.summary.vehiclesWithMovementShare,113/1693*100);
  assert.equal(data.summary.ambulanceVehiclesWithWaybillsShare,32/497*100);
  assert.notEqual(data.summary.vehiclesWithWaybills,data.detail.waybills);
});

test("regional November summary uses exact source totals 02–08.11",()=>{
  assert.deepEqual(weekly.current.systemSummary,{
    organizations:126,vehicles:1691,vehiclesWithWaybills:878,vehiclesWithMovement:736
  });
  assert.equal(weekly.current.detail.waybills,3171);
  assert.equal(weekly.current.detail.driversWithWaybills,1453);
  assert.equal(weekly.current.detail.vehiclesWithMovement,736);
  assert.equal(weekly.current.detail.organizationsWithMovement,98);
  assert.equal(weekly.current.detail.zeroMovementOrganizations,23);
  assert.equal(weekly.current.detail.zeroVehicleOrganizations,2);
  assert.ok(Math.abs(weekly.current.detail.movementShare-736/1691*100)<1e-10);
  assert.equal(weekly.previous.systemSummary.vehiclesWithMovement,110);
  assert.equal(weekly.previous.systemSummary.vehiclesWithWaybills,149);
  assert.equal(weekly.previous.detail.waybills,301);
});

test("123 groups and all 168 primary-source rows are preserved; missing 39–41 are not zeros",()=>{
  for(const [slice,source] of [[data,octSource],[weekly.current,novSource]]){
    assert.equal(source.declaredOrganizations,126);
    assert.equal(source.numberedGroups,123);
    assert.equal(source.sourceRows,168);
    assert.deepEqual(source.missingGroupNumbers,[39,40,41]);
    assert.equal(slice.rows.length,123);
    assert.equal(slice.detail.organizations,123);
    assert.deepEqual(slice.rows.map(r=>r.sourceNumber),validNumbers);
    assert.equal(slice.rows.reduce((n,r)=>n+r.components.length,0),168);
    assert.equal(new Set(slice.rows.map(r=>r.sourceNumber)).size,123);
    for(const row of slice.rows){
      assert.ok(row.components.length>0);
      for(const field of fields)
        assert.equal(row[field],row.components.reduce((n,c)=>n+c[field],0),`${row.sourceNumber}:${field}`);
    }
    assert.deepEqual(detailTotals(source),source.detailTotal);
    const raw=parseRows(source);
    const restored=slice.rows.flatMap(r=>r.components);
    assert.deepEqual(restored.map(r=>fields.map(f=>r[f])),raw);
    assert.equal(slice.detail.vehicles,source.systemSummary.vehicles);
    assert.equal(slice.detail.vehiclesWithMovement,source.systemSummary.vehiclesWithMovement);
  }
  assert.equal(weekly.previous.rows.length,126);
  assert.deepEqual(weekly.missingCurrentGroups,[39,40,41]);
  assert.match(weekly.periodCorrection,/39–41/);
  assert.equal(data.quality.find(x=>x.field==="Состав организаций").difference,-3);
});

test("source names and all subsidiary rows retain matching attribution",()=>{
  const before=weekly.previous.rows;
  for(const row of weekly.current.rows){
    const base=before.find(x=>x.sourceNumber===row.sourceNumber);
    assert.ok(base,`no previous source group ${row.sourceNumber}`);
    assert.equal(row.components.length,base.components.length,`changed membership in group ${row.sourceNumber}`);
    for(let i=0;i<row.components.length;i++)
      if(row.sourceNumber!==45)assert.equal(row.components[i].name,base.components[i].name);
  }
  for(const row of [data.rows.find(x=>x.sourceNumber===45),weekly.current.rows.find(x=>x.sourceNumber===45)])
    assert.equal(row.name,'ГАУЗ "Городская детская больница №1 имени М.Ш.Уразаевой"');
  const kazan=weekly.current.rows.find(x=>x.sourceNumber===110);
  assert.equal(kazan.vehicles,126);
  assert.equal(kazan.moved,82);
  assert.equal(kazan.components.length,10);
  assert.equal(kazan.components.reduce((sum,c)=>sum+c.moved,0),82);
});

test("UI names October, flags 126/123 discrepancy and avoids an invented plan",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/Закрытый октябрь показан отдельно/u);
  assert.match(page,/data-testid="epl-source-perimeter-warning"/u);
  assert.equal(data.plan,null);
  assert.ok(weekly.comparisonRule.includes("26.10"));
  assert.ok(weekly.comparisonRule.includes("02–08"));
});

test("EPL hides exactly the two organizations with zero vehicles in week and month, preserving sources", () => {
  const expectedNames = [
    'Арский филиал "База медицинского обеспечения"',
    'ГАУЗ "Республиканский детский психоневрологический санаторий"',
  ].sort();
  for (const rows of [data.rows, weekly.current.rows, weekly.previous.rows]) {
    const excluded = rows.filter(row => row.vehicles === 0);
    assert.deepEqual(excluded.map(row => row.name).sort(), expectedNames);
    const visible = excludeZeroFleetOrganizations(rows);
    assert.equal(visible.length, rows.length - 2);
    assert.ok(visible.every(row => row.vehicles !== 0));
    assert.equal(visible.reduce((s,r) => s + r.vehicles,0), rows.reduce((s,r) => s+r.vehicles,0));
    assert.equal(visible.reduce((s,r) => s + r.moved,0), rows.reduce((s,r) => s+r.moved,0));
    assert.equal(visible.reduce((s,r) => s + r.waybills,0), rows.reduce((s,r) => s+r.waybills,0));
    assert.ok(visible.some(row => row.vehicles > 0 && row.moved === 0), "MO with fleet but no movement stay under control");
  }
  assert.equal(excludeZeroFleetOrganizations(data.rows).length,121);
  assert.equal(excludeZeroFleetOrganizations(weekly.current.rows).length,121);
  assert.equal(data.rows.length,123);
  assert.equal(weekly.current.rows.length,123);
  assert.equal(weekly.current.systemSummary.organizations,126);
  assert.equal(data.summary.organizations,126);
});

test("EPL filter is based on confirmed zero fleet, never equates missing source with no fleet", () => {
  const rows = [
    {name:"zero fleet", vehicles:0},
    {name:"missing source", vehicles:null},
    {name:"not supplied", vehicles:undefined},
    {name:"fleet without movement", vehicles:8, moved:0},
  ];
  assert.deepEqual(excludeZeroFleetOrganizations(rows).map(r=>r.name), [
    "missing source","not supplied","fleet without movement",
  ]);
});

test("both EPL detail periods apply no-fleet scope before zones, sorting and display", async () => {
  const page = await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/const waybillRows = excludeZeroFleetOrganizations\(/u);
  assert.match(page,/waybillMode === "week"[\s\S]*?electronicWaybillWeekly\.current\.rows[\s\S]*?electronicWaybill\.rows/u);
  assert.match(page,/Медицинские организации с транспортом/u);
  assert.doesNotMatch(page,/setWaybillStatus\("noFleet"\)/u);
  assert.doesNotMatch(page,/<option value="noFleet">/u);
  assert.match(page,/waybillRows\.filter\(\(r\) => waybillZone\(r\) === "noMovement"\)/u);
});
