import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { buildOctoberRating } from "../lib/october-rating.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("October uses closed data in the existing rating and preserves missing comparisons", () => {
  const months = read("app/monthly-2026-10.json");
  const september = read("app/rating/september-v2-inputs.json");
  const rows = buildOctoberRating(september, { ...read("app/monthly-mo.json"), ...months }, read("config/september-rating-v2.json"));
  assert.equal(rows.length, september.organizations.length);
  assert.equal(rows.filter(row => row.complete).length, 104);
  assert.ok(rows.filter(row => !row.complete).every(row => row.place === null && row.score === null));
  const agryz = rows.find(row => row.key.endsWith(".1088"));
  const preventive = agryz.metrics.find(metric => metric.id === "semd228");
  assert.deepEqual([preventive.numerator, preventive.denominator, preventive.period], [13426, 16875, "01.01–31.10.2026"]);
  assert.equal(agryz.metrics.find(metric => metric.id === "egpu").period, "01.10–31.10.2026");
  assert.ok(months.semd228.rows.every(row => row.june === null && row.change === null));
  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(page, /Октябрь · срез 122\/228/);
});
