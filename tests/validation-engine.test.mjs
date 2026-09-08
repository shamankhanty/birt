import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAiReviewQueue, validateDashboard } from "../lib/validation-engine.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const base = Object.freeze({
  indicatorRegistry: readJson("config/indicator-registry.json"),
  moRegistry: readJson("app/mo-registry.json"),
  moData: readJson("app/mo-data.json"),
  monthlyMo: readJson("app/monthly-mo.json"),
  operationalMo: readJson("app/operational-mo.json"),
  organizationStatus: readJson("app/organization-status.json"),
  physicianMetrics: readJson("app/physician-metrics.json"),
  moDetailOids: readJson("app/mo-detail-oids.json"),
  baselineSnapshot: readJson("baseline/validation-snapshot.json"),
});

const cloneInput = () => structuredClone(base);
const check = (report, id) => report.checks.find((item) => item.id === id);

test("accepted v4.6.0 reference is all PASS and sends nothing to AI", () => {
  const report = validateDashboard(base);
  assert.equal(report.overallStatus, "PASS");
  assert.deepEqual(report.summary, { checks: 15, PASS: 15, WARNING: 0, FAIL: 0, blocking: 0, aiReviewItems: 0 });
  assert.equal(createAiReviewQueue(report).reviewCount, 0);
  assert.equal(report.reportingPeriod.latestFullMonth, "август 2026");
  assert.equal(report.reportingPeriod.previousFullMonth, "июль 2026");
});

test("source plan drift from the canonical registry is a methodological FAIL", () => {
  const input = cloneInput();
  input.moData.hospital.plan = 90;
  const report = validateDashboard(input);
  assert.equal(check(report, "registry.metadata_source_alignment").status, "FAIL");
  assert.ok(report.aiReviewItems.some((item) => item.reviewReason === "methodology" && item.metric === "hospital" && item.field === "plan"));
});

test("source direction drift from the canonical registry is a methodological FAIL", () => {
  const input = cloneInput();
  input.operationalMo.shortInput.direction = undefined;
  const report = validateDashboard(input);
  assert.equal(check(report, "registry.metadata_source_alignment").status, "FAIL");
  assert.ok(report.aiReviewItems.some((item) => item.metric === "shortInput" && item.field === "direction"));
});

test("numerator/denominator arithmetic drift is a blocking FAIL", () => {
  const input = cloneInput();
  input.moData.egpu.rows[0].fact += 1;
  const report = validateDashboard(input);
  assert.equal(check(report, "calculation.ratio_components").status, "FAIL");
  assert.ok(report.aiReviewItems.some((item) => item.checkId === "calculation.ratio_components"));
});

test("trend arithmetic drift is a blocking FAIL", () => {
  const input = cloneInput();
  input.moData.death.rows[0].trend += 1;
  const report = validateDashboard(input);
  assert.equal(check(report, "calculation.trend").status, "FAIL");
});

test("duplicate medical organization inside a dataset is a blocking FAIL", () => {
  const input = cloneInput();
  input.monthlyMo.hospital.rows.push(structuredClone(input.monthlyMo.hospital.rows[0]));
  const report = validateDashboard(input);
  assert.equal(check(report, "data.duplicate_organizations").status, "FAIL");
});

test("new unresolved organization in an active rating indicator is FAIL", () => {
  const input = cloneInput();
  input.monthlyMo.hospital.rows.push({ name: "НЕИЗВЕСТНАЯ МО ДЛЯ ТЕСТА", june: 50, july: 51, change: 1 });
  const report = validateDashboard(input);
  assert.equal(check(report, "data.new_unresolved_organizations").status, "FAIL");
  assert.ok(report.aiReviewItems.some((item) => item.metric === "hospital"));
});

test("new unresolved organization outside the rating is WARNING and bypasses AI", () => {
  const input = cloneInput();
  input.monthlyMo.egpu.rows.push({ name: "НЕИЗВЕСТНАЯ МО ДЛЯ ТЕСТА", june: 99, july: 99, change: 0 });
  const report = validateDashboard(input);
  assert.equal(check(report, "data.new_unresolved_organizations").status, "WARNING");
  assert.equal(report.aiReviewItems.filter((item) => item.metric === "egpu").length, 0);
});

test("organization disappearing from an active comparable dataset is FAIL", () => {
  const input = cloneInput();
  input.monthlyMo.hospital.rows.splice(0, 1);
  const report = validateDashboard(input);
  assert.equal(check(report, "data.dropped_organizations").status, "FAIL");
  assert.equal(check(report, "data.row_count_drop").status, "FAIL");
});

test("new percentage above 100 is an anomaly WARNING and is routed to AI", () => {
  const input = cloneInput();
  input.moData.egpu.rows[0].fact = 105;
  // Keep the arithmetic check valid so this test isolates the anomaly route.
  const oid = input.moData.egpu.rows[0].oid;
  input.moDetailOids.egpu[oid].registered = 105;
  input.moDetailOids.egpu[oid].volume = 100;
  input.moData.egpu.rows[0].count = 105;
  const report = validateDashboard(input);
  assert.equal(check(report, "data.percentage_anomalies").status, "WARNING");
  assert.ok(report.aiReviewItems.some((item) => item.reviewReason === "anomaly" && item.metric === "egpu"));
});

test("period kind conflict is a blocking methodological FAIL", () => {
  const input = cloneInput();
  input.moData.hospital.period = "август 2026";
  const report = validateDashboard(input);
  assert.equal(check(report, "period.kind_compatibility").status, "FAIL");
  assert.ok(report.aiReviewItems.some((item) => item.reviewReason === "methodology" && item.metric === "hospital"));
});

test("AI queue contains FAIL/anomaly/methodology signals but not ordinary WARNING", () => {
  const input = cloneInput();
  input.monthlyMo.egpu.rows.push({ name: "НЕИЗВЕСТНАЯ МО ДЛЯ ТЕСТА", june: 99, july: 99, change: 0 });
  input.moData.egpu.rows[0].fact = 105;
  const oid = input.moData.egpu.rows[0].oid;
  input.moDetailOids.egpu[oid].registered = 105;
  input.moDetailOids.egpu[oid].volume = 100;
  input.moData.egpu.rows[0].count = 105;
  const report = validateDashboard(input);
  const queue = createAiReviewQueue(report);
  assert.ok(queue.items.some((item) => item.reviewReason === "anomaly"));
  assert.ok(!queue.items.some((item) => item.metric === "egpu" && item.organizationName === "НЕИЗВЕСТНАЯ МО ДЛЯ ТЕСТА"));
});
