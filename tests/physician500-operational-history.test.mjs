import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const page = fs.readFileSync("app/page.tsx", "utf8");
const adapter = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));

test("500+ operational mode uses the weekly snapshot and history is date-aggregated", () => {
  assert.match(page, /const DASHBOARD_VERSION = "5\.4\.5"/u);
  assert.match(page, /isOperationalPhysician500/u);
  assert.match(page, /physicianWeeklySnapshot\.summary\[matrixMetric\]/u);
  assert.match(page, /physicianOperationalRows/u);
  assert.match(page, /предыдущего оперативного среза 500\+ в архиве нет/u);
  assert.equal(weekly.date, "11.09.2026");
  assert.equal(weekly.summary.doctor500_therapist.numerator, 238);
  assert.equal(weekly.summary.doctor500_therapist.denominator, 1367);
  assert.match(adapter, /previousSummary/u);
  assert.match(adapter, /previousDatasets/u);
  assert.match(page, /const versionHistoryEntries = \[/u);
  assert.match(page, /sameDate\.items\.push/u);
});
