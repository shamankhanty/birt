import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const detailed = JSON.parse(fs.readFileSync("app/frmr-department-details.json", "utf8"));
const aggregate = JSON.parse(fs.readFileSync("app/frmr-reconciliation-data.json", "utf8"));
const component = fs.readFileSync("app/frmr-reconciliation.tsx", "utf8");
const ids = detailed.mos;
const total = (index) => detailed.rows.reduce((sum,row)=>sum+row[index],0);

test("all 1445 department-level records reconcile by MO, including 755 stage1 and 690 stage2", () => {
  assert.equal(detailed.cut,"22.10.2026");
  assert.equal(ids.length,115);
  assert.equal(detailed.sp.length,419);
  assert.equal(total(3),755);
  assert.equal(total(4),690);
  const summaries = new Map(aggregate.rows.map(row=>[row[0],row]));
  for(const [index,id] of ids.entries()){
    const actual = detailed.rows.filter(row=>row[0]===index);
    const expected=summaries.get(id);
    assert.ok(expected,id);
    assert.equal(actual.reduce((s,r)=>s+r[3]+r[4],0),expected[4],id);
    assert.equal(actual.reduce((s,r)=>s+r[3],0),expected[5],id);
    assert.equal(actual.reduce((s,r)=>s+r[4],0),expected[6],id);
    assert.ok(actual.every(row=>detailed.sp[row[2]][0]===index));
    assert.ok(actual.every(row=>row[3]>=0 && row[4]>=0 && row[3]+row[4]>0));
  }
  assert.equal(new Set(detailed.rows.map(row=>row.slice(0,3).join("|"))).size,detailed.rows.length);
});

test("RKB: all 17 surgeons are distributed across six actual structural units", () => {
  const mo=ids.indexOf("1094");
  assert.ok(mo>=0);
  const roles=detailed.roles;
  const surgeon=roles.findIndex(x=>x.toLocaleLowerCase("ru")==="врач-хирург");
  assert.ok(surgeon>=0);
  const rows=detailed.rows.filter(row=>row[0]===mo&&row[1]===surgeon);
  assert.equal(rows.reduce((s,r)=>s+r[3]+r[4],0),17);
  assert.equal(rows.length,6);
  const n=Object.fromEntries(rows.map(row=>[detailed.sp[row[2]][2],row[3]+row[4]]));
  assert.equal(n["Хирургическое отделение №1"],7);
  assert.equal(n["Хирургическое отделение №2"],6);
  assert.equal(Object.values(n).reduce((s,x)=>s+x,0),17);
});

test("public dataset is aggregated, not a staff registry", () => {
  const raw=fs.readFileSync("app/frmr-department-details.json","utf8");
  assert.doesNotMatch(raw,/СНИЛС|ФИО врача|дата рождения|телефон сотрудника/u);
  assert.doesNotMatch(raw,/\b\d{11}\b/u);
  for(const row of detailed.rows)assert.equal(row.length,5);
  assert.match(component,/frmrDepartmentList/u);
  assert.match(component,/selectedDepartment\.oid/u);
  assert.match(component,/Выберите должность и конкретное структурное подразделение/u);
  assert.match(component,/noPosition/u);
  assert.match(component,/wrongDepartment/u);
  assert.doesNotMatch(component,/type="file"|FileReader|download=/u);
});
