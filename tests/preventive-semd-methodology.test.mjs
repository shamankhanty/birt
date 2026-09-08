import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
const audit=JSON.parse(await readFile(new URL("../app/preventive-semd-audit.json",import.meta.url),"utf8"));
const updater=await readFile(new URL("../scripts/refresh_preventive_semd.py",import.meta.url),"utf8");

test("federal 2026 calculation uses per-organization MAX from REMD and FOMS",()=>{
  assert.equal(audit.summary.status,"ready");
  assert.equal(audit.summary.organizations,95);
  assert.equal(audit.summary.numerator,1557278);
  assert.equal(audit.summary.denominator,2036859);
  assert.ok(Math.abs(audit.summary.share-76.45487488333754)<1e-10);
  assert.equal(audit.summary.selected122,85);
  assert.equal(audit.summary.selected228,10);
  assert.equal(audit.summary.selectedEqual,2);
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
