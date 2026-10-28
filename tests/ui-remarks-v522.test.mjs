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
  assert.match(summary, /className="federalStatusButtons"/u);
  assert.match(summary, /role="group" aria-label="Статус показателя"/u);
  assert.match(summary, /onClick=\{\(\) => setFederalStatus\(key\)\}/u);
  assert.match(summary, /aria-pressed=\{federalStatus === key\}/u);
  assert.match(summary, /\["except-contract", "Все, кроме «В контракте»"\]/u);
  assert.match(summary, /\["В контракте", "В контракте"\]/u);
  assert.doesNotMatch(summary, /<select\s+aria-label="Статус показателя"/u);
  assert.match(summary, /\["other", "В контракте"/u);
  assert.doesNotMatch(page, /<span>08<\/span> Показатели на контроле РФ/u);
});

test("duplicate MAX regional block is removed", () => {
  assert.doesNotMatch(page, /regionalMaxPanel/u);
  assert.doesNotMatch(page, /РЕГИОНАЛЬНЫЙ КОНТРОЛЬ · МАХ/u);
});

test("Standalone MAX is removed, while indicators in section 02 remain active", () => {
  assert.doesNotMatch(page, /maxServiceSwitch|<section className="maxSection">|tab === "max"/u);
  assert.doesNotMatch(page, /\["max", "МАХ", "12"\]/u);
  assert.match(page,/data-testid="max-indicator-period-switch"/u);
  assert.match(page,/data-testid="max-indicator-summary"/u);
  assert.match(page,/data-testid="max-indicator-organization-table"/u);
  assert.match(page,/maxIndicatorSlice/u);
  assert.match(page,/const DASHBOARD_VERSION = RELEASE_VERSION/u);
  assert.match(css,/v5\.2\.3 hearing TOP-10 readability/u);
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
