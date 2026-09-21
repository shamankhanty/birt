import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const candidateInput = path.resolve(arg("--candidate", ""));
const testMode = process.argv.includes("--test-mode");
const candidate = path.basename(candidateInput) === "app" ? candidateInput : path.join(candidateInput, "candidate", "app");
const production = path.resolve(arg("--production", path.join(root, "app")));
const manifestPath = path.resolve(arg("--manifest", path.join(root, "baseline/current-production-manifest.json")));
const currentSnapshots = ["baseline/calculation-runtime-snapshot.json", "baseline/validation-snapshot.json", "validation/calculation-equivalence.json", "validation/validation-report.json", "validation/ai-review.json"];
if (!candidate) throw new Error("--candidate is required");

const reportPath = path.join(candidate, "..", "..", "report.json");
if (!fs.existsSync(reportPath)) throw new Error(`candidate report is missing: ${reportPath}`);
const report = read(reportPath);
const stats = report.statistics ?? {};
if (!["PARTIAL", "READY"].includes(report.state) || !(stats.preparedIndicators > 0)) {\n  throw new Error("candidate acceptance gate failed: expected PARTIAL/READY with at least one prepared indicator");\n}\nconst validation = report.formalValidation;
if (!validation || validation.summary?.FAIL || validation.summary?.blocking) throw new Error("candidate validation has FAIL or blocking issues");

const files = [...new Set(report.changedFiles ?? [])].sort();
if (!files.length) throw new Error("candidate has no changed files");
const before = {};
for (const name of fs.readdirSync(production).filter((name) => name.endsWith(".json"))) before[name] = sha256(path.join(production, name));
const manifestBefore = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
const backup = { files: before, manifest: manifestBefore?.toString("base64") ?? null };
const rollbackDir = path.join(root, "REPORTS", `current-production-rollback-${Date.now()}`);
fs.mkdirSync(path.join(rollbackDir, "app"), { recursive: true });
for (const name of Object.keys(before)) fs.copyFileSync(path.join(production, name), path.join(rollbackDir, "app", name));
const snapshotBackup = {};
for (const file of currentSnapshots) if (fs.existsSync(path.join(root, file))) { snapshotBackup[file] = fs.readFileSync(path.join(root, file)).toString("base64"); fs.mkdirSync(path.join(rollbackDir, path.dirname(file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(rollbackDir, file)); }
fs.writeFileSync(path.join(rollbackDir, "manifest.json"), JSON.stringify({ files: before, currentProductionManifest: backup.manifest, currentSnapshots: snapshotBackup }, null, 2));

try {
  for (const name of files) {
    const source = path.join(candidate, name);
    const target = path.join(production, name);
    if (!fs.existsSync(source)) throw new Error(`candidate file is missing: ${name}`);
    const current = read(target);
    const incoming = read(source);
    const merged = { ...current };
    for (const key of Object.keys(current)) {
      if (!(key in incoming)) throw new Error(`candidate removed production section ${name}:${key}`);
    }
    for (const [key, value] of Object.entries(incoming)) if (JSON.stringify(current[key]) !== JSON.stringify(value)) merged[key] = value;
    fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
  }
  if (testMode) { console.log(JSON.stringify({ status: "TEST_MODE", note: "snapshot generation intentionally delegated to lifecycle fixture" })); }
  const validation = testMode ? { status: 0 } : spawnSync(process.execPath, ["scripts/run-validation.mjs"], { cwd: root, encoding: "utf8" });
  if (validation.status !== 0) throw new Error(`post-production validation failed: ${validation.stdout}\n${validation.stderr}`);
  const calculation = testMode ? { status: 0 } : spawnSync(process.execPath, ["scripts/run-calculation-equivalence.mjs"], { cwd: root, encoding: "utf8" });
  const snapshotValidation = testMode ? { status: 0 } : spawnSync(process.execPath, ["scripts/promote_validation_baseline.mjs"], { cwd: root, encoding: "utf8" });
  if (snapshotValidation.status !== 0) throw new Error(`validation snapshot generation failed: ${snapshotValidation.stderr}`);
  const snapshotCalculation = testMode ? { status: 0 } : spawnSync(process.execPath, ["scripts/promote_calculation_baseline.mjs"], { cwd: root, encoding: "utf8" });
  if (snapshotCalculation.status !== 0) throw new Error(`calculation snapshot generation failed: ${snapshotCalculation.stderr}`);
  const promoted = { schemaVersion: 1, kind: "current-production", promotedFrom: candidate, promotedAt: new Date().toISOString(), files: {} };
  for (const name of fs.readdirSync(production).filter((name) => name.endsWith(".json")).sort()) promoted.files[`app/${name}`] = sha256(path.join(production, name));
  for (const file of currentSnapshots) if (fs.existsSync(path.join(root, file))) promoted.files[file] = sha256(path.join(root, file));
  fs.writeFileSync(manifestPath, `${JSON.stringify(promoted, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", promotedFrom: candidate, changedFiles: files, manifest: manifestPath, rollback: rollbackDir }));
} catch (error) {
  for (const [name, digest] of Object.entries(backup.files)) {
    const target = path.join(production, name);
    if (sha256(target) !== digest) throw new Error(`promotion failed and rollback hash check failed for ${name}: ${error.message}`);
  }
  if (backup.manifest === null) fs.rmSync(manifestPath, { force: true });
  else fs.writeFileSync(manifestPath, Buffer.from(backup.manifest, "base64"));
  for (const [file, encoded] of Object.entries(snapshotBackup)) fs.writeFileSync(path.join(root, file), Buffer.from(encoded, "base64"));
  throw error;
}
