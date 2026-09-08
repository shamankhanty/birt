import fs from "node:fs";
import path from "node:path";
import { createAiReviewQueue, validateDashboard } from "../lib/validation-engine.js";
import { resolveReportingPeriods } from "../lib/period-engine.js";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const appDir = process.env.DASHBOARD_APP_DIR || "app";
const validationDir = process.env.DASHBOARD_VALIDATION_DIR || "validation";
const appFile = (name) => path.join(appDir, name);
const indicatorRegistry = readJson("config/indicator-registry.json");
const moRegistry = readJson(appFile("mo-registry.json"));
const moData = readJson(appFile("mo-data.json"));
const monthlyMo = readJson(appFile("monthly-mo.json"));
const operationalMo = readJson(appFile("operational-mo.json"));
const organizationStatus = readJson(appFile("organization-status.json"));
const physicianMetrics = readJson(appFile("physician-metrics.json"));
const moDetailOids = readJson(appFile("mo-detail-oids.json"));
const baselineSnapshot = readJson("baseline/validation-snapshot.json");

const reporting = resolveReportingPeriods({
  monthlyDatasets: monthlyMo,
  datasets: [...Object.values(moData), ...Object.values(operationalMo), ...Object.values(organizationStatus)],
  physicianMetrics,
});

const report = validateDashboard({
  indicatorRegistry,
  moRegistry,
  moData,
  monthlyMo,
  operationalMo,
  organizationStatus,
  physicianMetrics,
  moDetailOids,
  baselineSnapshot,
  reporting,
});
const aiQueue = createAiReviewQueue(report);
fs.mkdirSync(validationDir, { recursive: true });
fs.writeFileSync(path.join(validationDir, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(validationDir, "ai-review.json"), `${JSON.stringify(aiQueue, null, 2)}\n`);

console.log(`Validation: ${report.overallStatus}; checks=${report.summary.checks}; PASS=${report.summary.PASS}; WARNING=${report.summary.WARNING}; FAIL=${report.summary.FAIL}; AI=${report.summary.aiReviewItems}`);
for (const check of report.checks.filter((item) => item.status !== "PASS")) {
  console.log(`${check.status} ${check.id}: ${check.message}`);
}
if (report.overallStatus === "FAIL") process.exitCode = 1;
