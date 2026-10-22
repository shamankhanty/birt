import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("relocated summary provides the all-except-contract status filter and the contract band", () => {
  const start = page.indexOf('{tab === "unified" && (');
  const end = page.indexOf('{tab === "ranking" && (', start);
  const summary = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(summary, /aria-label="Статус показателя"/u);
  assert.match(summary, /onChange=\{\(event\) => setFederalStatus\(event\.target\.value\)\}/u);
  assert.match(summary, /<option value="except-contract">[\s\S]*?Все, кроме «В контракте»/u);
  assert.match(summary, /<option>В контракте<\/option>/u);
  assert.match(summary, /\["other", "В контракте"/u);
  assert.doesNotMatch(page, /<span>08<\/span> Показатели на контроле РФ/u);
});

test("duplicate MAX regional block is removed", () => {
  assert.doesNotMatch(page, /regionalMaxPanel/u);
  assert.doesNotMatch(page, /РЕГИОНАЛЬНЫЙ КОНТРОЛЬ · МАХ/u);
});

test("MAX has one active service and compact monthly cards", () => {
  assert.match(page, /maxServiceSwitch/u);
  assert.match(page, /setMaxService\("visit"\)/u);
  assert.match(page, /setMaxService\("tmk"\)/u);
  assert.match(page, /setMaxService\("eln"\)/u);
  assert.match(page, /maxMonthCards/u);
  assert.match(css, /v5\.2\.2 compact MAX and service selector/u);
  assert.match(page, /const DASHBOARD_VERSION = RELEASE_VERSION/u);
  assert.ok(page.indexOf('["max", "МАХ", "05"]') > page.indexOf('["divider", "В разработке", ""]'));
  assert.ok(page.includes('developmentSection ${tab === "max"'));
  assert.doesNotMatch(page, /className=\{tab === "max" \? "active" : ""\}/u);
  assert.match(css, /v5\.2\.3 hearing TOP-10 readability/u);
});

test("hearing card uses the fixed management grouping", () => {
  for (const label of [
    "СЭМД относительно случаев / обращений",
    "ТВСП",
    "Врачи / электронная подпись / 500+",
    "ЕПГУ и цифровые сервисы",
    "Прочие количественные / технологические показатели",
    "Справочные / неприменимые / без сопоставимого плана / без необходимых данных",
  ]) assert.match(page, new RegExp(label, "u"));
  assert.match(page, /function hearingMetricGroupsForDisplay/u);
  assert.match(page, /metric\.regionalContribution/u);
  assert.match(page, /<section className="hearingMetricGroup"/u);
});
