import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
const audit=JSON.parse(await readFile(new URL("../app/preventive-semd-audit.json",import.meta.url),"utf8"));
const updater=await readFile(new URL("../scripts/refresh_preventive_semd.py",import.meta.url),"utf8");

test("federal 2026 calculation uses per-organization MAX from REMD and FOMS",async()=>{
  assert.equal(audit.summary.status,"ready");
  assert.equal(audit.summary.organizations,95);
  assert.equal(audit.summary.numerator,1915517);
  assert.equal(audit.summary.denominator,2281382);
  assert.equal(audit.summary.period122,'01.01–13.10.2026');
  assert.equal(audit.summary.period228,'01.01–13.10.2026');
  assert.deepEqual(audit.excluded.map(r=>[r.oid,r.denominator]),[['1.2.643.5.1.13.13.12.2.18.1384',1]]);
  const dataset=JSON.parse(await readFile(new URL('../app/mo-data.json',import.meta.url),'utf8')).semd228;
  const missing=dataset.rows.find(r=>r.oid===audit.excluded[0].oid);
  assert.equal(missing.fact,null);
  assert.equal(missing.count,null);
  assert.ok(audit.summary.numerator > 0);
  assert.ok(audit.summary.denominator > 0);
  assert.equal(audit.summary.share, audit.summary.numerator / audit.summary.denominator * 100);
  assert.ok(audit.summary.selected122 >= 0);
  assert.ok(audit.summary.selected228 >= 0);
  assert.ok(audit.summary.selectedEqual >= 0);
  assert.notEqual(audit.summary.childrenMissing,true);
  assert.ok(audit.rows.every(row=>row.selected===Math.max(row.semd122,row.semd228)));
});

test("base updater selects per-organization MAX and never substitutes a missing source with zero",()=>{
  assert.match(updater,/max\(semd122, semd228\)/);
  assert.match(updater,/semd122 is not None and semd228 is not None/);
  assert.match(updater,/Расчёт заблокирован/);
  assert.match(source,/включает взрослые и детские МО/);
  assert.match(source,/В расчёт включены взрослые и детские/);
});

test("methodology cards expose Vitacore routes only for mapped SEMD shares",()=>{
  assert.match(source,/Как сформировать СЭМД в МИС Витакор/);
  assert.match(source,/vitacoreInstructions\[m\.id\]/);
  assert.match(source,/federalPeriodType\(row\)/);
});

test("dashboard states the transition rule for 2026 and 2027",()=>{
  assert.match(source,/2026: MAX\(СЭМД 122; СЭМД 228\)/);
  assert.match(source,/С 01\.01\.2027: СЭМД 228/);
  assert.match(source,/не суммируются/);
});
