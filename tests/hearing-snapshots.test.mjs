import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const snapshots=JSON.parse(await readFile(new URL("../app/hearing-snapshots.json",import.meta.url),"utf8"));
const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");

test("all twelve heard organizations have immutable restored baselines",()=>{
  assert.equal(snapshots.fixedAt,"25.08.2026 14:13 МСК");
  assert.equal(Object.keys(snapshots.organizations).length,12);
  for(const organization of Object.values(snapshots.organizations)){
    assert.ok(organization.fixedAt,`${organization.name}: отсутствует дата заслушивания`);
    assert.ok(Object.keys(organization.metrics).length>=1,`${organization.name}: недостаточно показателей`);
    for(const metric of Object.values(organization.metrics)){
      assert.ok(metric.date,"у показателя отсутствует дата среза");
      assert.ok(metric.name,"у показателя отсутствует название");
    }
  }
});

test("hearing UI compares current metrics with the restored baseline",()=>{
  assert.match(source,/hearingSnapshotSummary\(row\)/);
  assert.match(source,/Контрольная точка/);
  assert.match(source,/DASHBOARD_VERSION\s*=\s*"5\.2\.0"/);
});

test("missing source data is neutral in hearing influence",()=>{
  assert.match(source,/status: applicable \? "missing" : "reference"/);
  assert.match(source,/passed: null/);
  assert.match(source,/regionalContribution: null/);
});

test("navigation separates working and development sections and exposes history",()=>{
  assert.match(source,/История обновлений/);
  assert.match(source,/sideDevelopment/);
  assert.match(source,/Электронный путевой лист/);
  assert.match(source,/hearingChangeFilter/);
});

test("indicator action guide is collapsed and methodology follows it",()=>{
  assert.match(source,/<details className="actionGuide">/);
  assert.doesNotMatch(source,/<details className="actionGuide" open>/);
  assert.match(source,/function MethodologyGuide/);
  assert.match(source,/<strong>Методика расчёта<\/strong>/);
  assert.match(source,/selectedMethodology=\{selectedMethodology\}/);
});

test("DRKB and Naberezhnye Chelny GP7 are marked as heard",()=>{
  assert.match(source,/1\.2\.643\.5\.1\.13\.13\.12\.2\.16\.1155/);
  assert.match(source,/1\.2\.643\.5\.1\.13\.13\.12\.2\.16\.1115/);
});

test("primary emergency-department examination belongs to transfer group",()=>{
  assert.match(source,/при\[её\]много отделения/);
  assert.match(source,/Сопоставимый региональный расчёт по методике показателя не представлен/);
});
