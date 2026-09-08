import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildFullMonthComparison,
  datasetBelongsToReportingMonth,
  datasetHasExplicitFullMonth,
  inferPeriodKind,
  resolveReportingPeriods,
} from "../lib/period-engine.js";

const monthlyRaw = JSON.parse(fs.readFileSync("app/monthly-mo.json", "utf8"));
const moRaw = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const operational = JSON.parse(fs.readFileSync("app/operational-mo.json", "utf8"));
const status = JSON.parse(fs.readFileSync("app/organization-status.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));
const registry = JSON.parse(fs.readFileSync("config/indicator-registry.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

const mergedData = { ...moRaw, ...operational, ...status, ...physicians.datasets };
const monthlyRuntime = monthlyRaw;

const reporting = resolveReportingPeriods({
  monthlyDatasets: monthlyRuntime,
  datasets: Object.values(mergedData),
  physicianMetrics: physicians,
});

test("period engine detects August 2026 as the latest full month and July as previous", () => {
  assert.equal(reporting.latestFullMonth.label, "август 2026");
  assert.equal(reporting.latestFullMonth.endDate, "31.08.2026");
  assert.equal(reporting.previousFullMonth.label, "июль 2026");
  assert.equal(reporting.previousFullMonth.endDate, "31.07.2026");
});

test("period engine ignores an incomplete newer month when choosing the full month", () => {
  const withSeptemberOperational = resolveReportingPeriods({
    monthlyDatasets: monthlyRuntime,
    datasets: [...Object.values(mergedData), { date: "07.09.2026", period: "01.09–07.09.2026" }],
    physicianMetrics: physicians,
  });
  assert.equal(withSeptemberOperational.latestFullMonth.label, "август 2026");
  assert.equal(withSeptemberOperational.latestObservedDate, "07.09.2026");
  assert.equal(withSeptemberOperational.latestObservedMonth.label, "сентябрь 2026");
  assert.equal(withSeptemberOperational.hasPartialNewerMonth, true);
});

test("period engine advances automatically when a new full calendar month appears", () => {
  const future = resolveReportingPeriods({
    monthlyDatasets: {
      ...monthlyRuntime,
      syntheticSeptember: { unit: "%", previousLabel: "Август 2026", currentLabel: "Сентябрь 2026", rows: [] },
    },
    datasets: [...Object.values(mergedData), { date: "30.09.2026", period: "сентябрь 2026", periodType: "month" }],
    physicianMetrics: physicians,
  });
  assert.equal(future.latestFullMonth.label, "сентябрь 2026");
  assert.equal(future.previousFullMonth.label, "август 2026");
});

test("period kinds are inferred deterministically from source metadata", () => {
  assert.equal(inferPeriodKind({ period: "01.01–31.08.2026" }), "cumulative");
  assert.equal(inferPeriodKind({ period: "август 2026", periodType: "month" }), "monthly");
  assert.equal(inferPeriodKind({ currentLabel: "На 28.08", period: "01.01–28.08.2026" }), "cumulative");
  assert.equal(inferPeriodKind({ currentLabel: "На 07.09" }), "snapshot");
});

test("approved full-month cumulative comparison is reproduced without hard-coded August dates", () => {
  assert.deepEqual(buildFullMonthComparison(reporting, "cumulative"), {
    previous: "01.01–31.07.2026",
    current: "01.01–31.08.2026",
  });
  assert.deepEqual(buildFullMonthComparison(reporting, "monthly"), {
    previous: "июль 2026",
    current: "август 2026",
  });
});

test("rating-month detection reproduces the exact 17 active baseline indicators", () => {
  const excluded = new Set(["errors", "tvspLaboratory", "egpu2days", "egpu", "birth"]);
  const active = Object.entries(monthlyRuntime)
    .filter(([id, dataset]) =>
      dataset.unit === "%" &&
      datasetBelongsToReportingMonth(dataset, reporting.latestFullMonth) &&
      mergedData[id]?.plan !== null &&
      mergedData[id]?.plan !== undefined &&
      !excluded.has(id),
    )
    .map(([id]) => id)
    .sort();
  const baselineActive = Object.entries(registry.indicators)
    .filter(([, item]) => item.rating.baselineActive)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(active, baselineActive);
});

test("explicit full-month marker is distinguished from an intra-month cumulative snapshot", () => {
  assert.equal(datasetHasExplicitFullMonth({ currentLabel: "На 31.08", date: "31.08.2026" }, reporting.latestFullMonth), true);
  assert.equal(datasetHasExplicitFullMonth({ currentLabel: "На 28.08", date: "28.08.2026" }, reporting.latestFullMonth), false);
  assert.equal(datasetBelongsToReportingMonth({ currentLabel: "На 28.08", date: "28.08.2026" }, reporting.latestFullMonth), true);
});

test("page runtime uses the period engine for rating selection and full-month comparison", () => {
  assert.match(page, /resolveReportingPeriods\(/u);
  assert.match(page, /datasetBelongsToReportingMonth\(/u);
  assert.match(page, /buildFullMonthComparison\(/u);
  assert.doesNotMatch(page, /dataset\.currentLabel[^\n]+Август\|31\\\.08\|28\\\.08\|29\\\.08/u);
});
