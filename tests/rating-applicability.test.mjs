import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const registry = JSON.parse(await readFile(new URL("../app/mo-registry.json", import.meta.url), "utf8"));
const indicatorRegistry = JSON.parse(await readFile(new URL("../config/indicator-registry.json", import.meta.url), "utf8"));

test("rating denominator comes from each organization's applicability matrix", () => {
  assert.ok(registry.organizations.every(org => Array.isArray(org.applicable)));
  assert.match(source, /const applicable\s*=\s*\[\.\.\.eligibleIds\]\.filter\([\s\S]+?evaluableForRegistry\(item\.registry,\s*id\)[\s\S]+?\)/u);
  assert.match(source, /coverage:\s*\(item\.details\.length\s*\/\s*Math\.max\(1,\s*applicable\.length\)\)\s*\*\s*100/u);
});

test("missing mandatory indicators remain neutral and inapplicable indicators stay excluded", () => {
  assert.match(source, /const expected\s*=\s*applicable\.filter\([\s\S]+?ratingBlock\(id\)\s*===\s*block[\s\S]+?\)/u);
  assert.match(source, /if\s*\(!detail\)\s*return \[\]/u);
  assert.match(source, /Неприменимый показатель исключается/u);
  assert.match(source, /<em>без оценки<\/em>/u);
});

test("ranking uses August full-month data and excludes metrics removed from the rating", () => {
  assert.match(source, /Object\.entries\(monthlyMoData\)/u);
  assert.match(source, /Август\|31\\\.08\|28\\\.08\|29\\\.08/u);
  assert.match(source, /const score\s*=\s*scoreAgainstPlan\(/u);
  assert.match(source, /indicatorRegistry\.canEnterRating\(id\)/u);
  for (const id of ["errors", "tvspLaboratory", "egpu2days", "egpu", "birth"]) {
    assert.equal(indicatorRegistry.indicators[id].rating.policy, "exclude", id);
  }
  assert.match(source, /Показатели ЕПГУ и свидетельств о\s+рождении остаются в мониторинге, но из рейтинга\s+исключены/u);
  assert.match(source, /Рейтинг медицинских организаций — август 2026/u);
  assert.match(source, /сентябрьские\s+оперативные срезы на места не влияют/u);
});

test("organizations with no available mandatory data receive no ranking place", () => {
  assert.match(source, /const score\s*=\s*item\.details\.length\s*\?\s*current\.score\s*:\s*null/u);
  assert.match(source, /currentRating\.filter\([\s\S]+?r\.score\s*!==\s*null[\s\S]+?\)/u);
});
