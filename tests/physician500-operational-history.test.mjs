import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const page = fs.readFileSync("app/page.tsx", "utf8");
const adapter = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
const transactionalStage = fs.readFileSync("scripts/pipeline/transactional_stage.py", "utf8");
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));

test("500+ operational mode uses the weekly snapshot and history is date-aggregated", () => {
  assert.match(page, /const DASHBOARD_VERSION = "5\.4\.5"/u);
  assert.match(page, /isOperationalPhysician500/u);
  assert.match(page, /physicianWeeklySnapshot\.summary\[matrixMetric\]/u);
  assert.match(page, /physicianOperationalRows/u);
  assert.match(page, /предыдущего оперативного среза 500\+ в архиве нет/u);
  assert.match(weekly.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(weekly.summary.doctor500_therapist.numerator >= 0);
  assert.ok(weekly.summary.doctor500_therapist.denominator > 0);
  assert.match(adapter, /previousSummary/u);
  assert.match(adapter, /previousDatasets/u);
  assert.match(page, /const versionHistoryEntries = \[/u);
  assert.match(page, /sameDate\.items\.push/u);
});

test("accepted 500+ source period is promoted to snapshot top-level metadata", () => {
  assert.match(transactionalStage, /merged\['date'\]\s*=\s*new_date/u);
  assert.match(transactionalStage, /merged\['period'\]\s*=\s*merged\['periods'\]\[metric\]\['period'\]/u);
  assert.match(transactionalStage, /merged\['source'\]\s*=\s*item\['name'\]/u);
  assert.match(transactionalStage, /parse_iso\(item\['startDate'\]\)/u);
});
