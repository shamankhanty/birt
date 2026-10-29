import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const weekly = read("app/error-categories.json");
weekly.organizationBreakdown = read("app/error-organizations.json");
const cumulative = read("app/error-cumulative.json");
const page = fs.readFileSync("app/page.tsx", "utf8");

function validate(data) {
  const breakdown = data.organizationBreakdown;
  assert.equal(data.items.reduce((sum, row) => sum + row.count, 0), data.total);
  assert.equal(breakdown.totalErrors, data.total);
  assert.equal(breakdown.attributedErrors + breakdown.unassignedErrors, data.total);
  assert.equal(breakdown.organizationCount, breakdown.organizations.length);
  assert.equal(breakdown.organizations.reduce((sum, row) => sum + row.count, 0), breakdown.attributedErrors);
  const counts = new Map();
  for (const org of breakdown.organizations) {
    assert.equal(org.categories.reduce((sum, row) => sum + row.count, 0), org.count);
    for (const row of org.categories) counts.set(row.name, (counts.get(row.name) ?? 0) + row.count);
  }
  for (const row of breakdown.unassignedCategories) counts.set(row.name, (counts.get(row.name) ?? 0) + row.count);
  assert.deepEqual(Object.fromEntries(counts), Object.fromEntries(data.items.map(row => [row.name, row.count])));
  assert.equal(breakdown.sourcePeriod, data.period);
}

test("both error periods reconcile by category and organization independently", () => {
  validate(weekly);
  validate(cumulative);
  assert.equal(cumulative.total, 14216686);
  assert.equal(cumulative.period, "01.01.2026–28.10.2026");
  assert.equal(cumulative.organizationBreakdown.organizationCount, 330);
  assert.equal(cumulative.share, null);
  assert.equal(cumulative.periodKind, "cumulative");
});

test("period selector uses independent source payloads without adding weekly totals", () => {
  const expression = page.match(/const selectedErrorData = ([\s\S]*?);/u)?.[1];
  assert.ok(expression);
  const select = new Function("errorPeriod", "errorCumulativeRaw", "errorCategories",
    "return " + expression.replace(" as typeof errorCategories", ""));
  const before = JSON.stringify([weekly, cumulative]);
  assert.equal(select("weekly", cumulative, weekly), weekly);
  assert.equal(select("cumulative", cumulative, weekly), cumulative);
  assert.equal(JSON.stringify([weekly, cumulative]), before);
  const section = page.slice(page.indexOf('{tab === "remdErrors" && <>'), page.indexOf('{tab === "errors" && <>'));
  assert.ok(section.includes('selectedErrorData.total'));
  assert.ok(section.includes('selectedErrorData.period'));
  assert.ok(section.includes('selectedErrorData.items.map'));
  assert.ok(!section.includes('errorCategories.'));
  assert.ok(page.includes('const errorBreakdown = selectedErrorData.organizationBreakdown'));
});

test("switching period clears selections that belong to another period", () => {
  const body = page.match(/const changeErrorPeriod = \(period: "cumulative" \| "weekly"\) => \{([\s\S]*?)\n  \};/u)?.[1];
  assert.ok(body);
  const changes = {};
  new Function("period", "setErrorPeriod", "setSelectedErrorCategory", "setSelectedErrorOrganization", "setErrorOrganizationQuery", body)(
    "cumulative", v => changes.period = v, v => changes.category = v, v => changes.organization = v, v => changes.query = v,
  );
  assert.deepEqual(changes, {period:"cumulative", category:null, organization:null, query:""});
});
