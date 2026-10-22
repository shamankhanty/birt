import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const status = JSON.parse(await readFile(new URL("../app/organization-status.json", import.meta.url), "utf8"));
const federal = JSON.parse(await readFile(new URL("../app/federal-control.json", import.meta.url), "utf8"));
const adapters = await readFile(new URL("../scripts/pipeline/adapters.py", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const mkdcOid = "1.2.643.5.1.13.13.12.2.16.1079";

test("MKDC is not counted in the current ELMK denominator", () => {
  assert.equal(status.elmk.rows.some((row) => row.oid === mkdcOid), false);
  assert.deepEqual(
    { numerator: status.elmk.numerator, denominator: status.elmk.denominator, fact: status.elmk.fact },
    { numerator: 73, denominator: 73, fact: 100 },
  );
  assert.equal(status.elmk.quantity, 73);
  assert.match(status.elmk.note, /лицензия отозвана/u);
});

test("the composition correction is not shown as indicator dynamics", () => {
  assert.equal(status.elmk.comparisonReset, true);
  assert.match(status.elmk.comparisonResetReason, /несопоставим/u);
  assert.match(page, /comparisonReset: source\.comparisonReset \?\? item\.comparisonReset/u);
  const start = page.indexOf('{tab === "unified" && (');
  const end = page.indexOf('{tab === "ranking" && (', start);
  const summary = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(summary, /regionalTrend|trendGood|trendBad/u);
  assert.match(summary, /Исполнение плана/u);
});

test("future ELMK imports preserve the explicit applicability rule", () => {
  assert.match(adapters, new RegExp(mkdcOid.replaceAll(".", "\\."), "u"));
  assert.match(adapters, /family == "elmk" and oid in elmk_inapplicable_oids/u);
  assert.match(adapters, /comparison_reset = bool\(base\.get\("comparisonReset"\)\) if same_cut else False/u);
});

test("federal historical snapshot is not silently recalculated", () => {
  const row = federal.agreement.find((item) => item.id === "10");
  assert.equal(row.plan, "100% · 73 применимые МО");
  assert.equal(row.federal, "52 из 74 · 70%");
  assert.match(row.sourceNote, /исторический шестимесячный срез/u);
});
