import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { RELEASE_VERSION } from "../lib/release-runtime-metadata.js";

const root = process.cwd();
const reportPath = path.join(root, "validation/indicator-metadata-equivalence.json");
const baselinePath = path.join(root, "baseline/indicator-metadata-snapshot.json");
const run = spawnSync(process.execPath, ["scripts/run-indicator-metadata-equivalence.mjs"], {
  cwd: root,
  encoding: "utf8",
});
if (!fs.existsSync(reportPath)) throw new Error(`indicator metadata report is missing: ${run.stderr || run.stdout}`);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const unexpected = (report.mismatches ?? []).filter(
  (item) => item.scope !== "rating" || item.id !== "activeIds" || item.field !== "ids" || !Array.isArray(item.actual),
);
if (unexpected.length) throw new Error(`indicator metadata has unexpected drift: ${JSON.stringify(unexpected)}`);

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const activeIds = report.mismatches?.[0]?.actual ?? baseline.rating.activeIds;
if (!Array.isArray(activeIds) || !activeIds.length) throw new Error("rating activeIds cannot be empty");
baseline.baselineVersion = RELEASE_VERSION;
baseline.rating.activeIds = activeIds;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);

const verify = spawnSync(process.execPath, ["scripts/run-indicator-metadata-equivalence.mjs", "--check"], {
  cwd: root,
  encoding: "utf8",
});
if (verify.status !== 0) throw new Error(`accepted indicator metadata verification failed: ${verify.stdout}\n${verify.stderr}`);
console.log(JSON.stringify({ status: "PASS", baselineVersion: RELEASE_VERSION, ratingIndicators: activeIds.length }));
