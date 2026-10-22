import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf('{tab === "unified" && (');
const end = page.indexOf('{tab === "ranking" && (', start);
const summary = page.slice(start, end);

test("section 01 shows four plan-attainment bands plus the contract category", () => {
  assert.ok(start >= 0 && end > start, "section 01 must render");
  assert.match(page, /type FederalPlanZone = "critical" \| "lag" \| "near" \| "achieved" \| "other"/u);
  for (const label of ["Критическое", "Отставание", "Близко к плану", "План достигнут", "В контракте"]) {
    assert.ok(summary.includes(label), "summary must include " + label);
  }
  assert.match(summary, /Менее 80% плана/u);
  assert.match(summary, /80–94,9% плана/u);
  assert.match(summary, /95–99,9% плана/u);
  assert.match(summary, /100% и более/u);
});

test("plan bands are non-overlapping, sortable and respect filters", () => {
  assert.match(page, /score >= 100 \? "achieved"/u);
  assert.match(page, /score >= 95 \? "near"/u);
  assert.match(page, /score >= 80 \? "lag" : "critical"/u);
  assert.match(page, /federalPlanBand === "all" \|\| item\.assessment\.zone === federalPlanBand/u);
  assert.match(page, /rank\[a\.assessment\.zone\] - rank\[b\.assessment\.zone\]/u);
  assert.match(page, /selectedIds\.has\(item\.row\.id\)/u);
  assert.match(page, /federalLowerIsBetter\(row\)/u);
});

test("section 01 retains the five top KPI values but removes their explanatory paragraphs", () => {
  const top = summary.slice(0, summary.indexOf('className="pageHead federalHead"'));
  assert.match(top, /extendedOperational\.map\(\(o\) =>/u);
  assert.match(top, /<strong>\{format\(o\.value, 0\)\}<\/strong>/u);
  assert.doesNotMatch(top, /<p>\{o\.note\}<\/p>/u);
  assert.match(summary, /<h1>Расширенная сводка<\/h1>/u);
  assert.match(page, /\{tab === "matrix" && \(/u);
  assert.doesNotMatch(page, /<span>08<\/span> Показатели на контроле РФ/u);
});

test("missing values are not converted into zero in the plan-attainment group", () => {
  assert.match(page, /useState<FederalPlanZone \| "all">\("all"\)/u);
  assert.match(page, /if \(value === null \|\| plan\.value === null/u);
  assert.match(page, /zone: "other", score: null/u);
  assert.match(summary, /В контракте · расчёт не представлен/u);
});
