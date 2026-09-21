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
if (!candidateInput) throw new Error("--candidate is required");

const reportPath = path.join(candidate, "..", "..", "report.json");
if (!fs.existsSync(reportPath)) throw new Error(`candidate report is missing: ${reportPath}`);
const report = read(reportPath);
const stats = report.statistics ?? {};
if (!["PARTIAL", "READY"].includes(report.state) || !(stats.preparedIndicators > 0)) {
  throw new Error("candidate acceptance gate failed: expected PARTIAL/READY with at least one prepared indicator");
}
const candidateValidation = report.formalValidation;
if (!candidateValidation) throw new Error("candidate formal validation is missing");
if ((candidateValidation.summary?.FAIL ?? 0) > 0 || (candidateValidation.summary?.blocking ?? 0) > 0) {
  throw new Error("candidate validation has FAIL or blocking issues");
}
const preparedIndicatorIds = new Set(
  (report.indicators ?? [])
    .filter((indicator) => indicator.state === "PREPARED" && typeof indicator.metric === "string")
    .map((indicator) => indicator.metric),
);

const files = [...new Set(report.changedFiles ?? [])].sort();
if (!files.length) throw new Error("candidate has no changed files");
for (const name of files) {
  if (typeof name !== "string" || path.basename(name) !== name || !name.endsWith(".json")) {
    throw new Error(`invalid changed file name: ${name}`);
  }
}

const before = {};
for (const name of fs.readdirSync(production).filter((name) => name.endsWith(".json"))) before[name] = sha256(path.join(production, name));
const manifestBefore = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : null;
const backup = { files: before, manifest: manifestBefore?.toString("base64") ?? null };
const rollbackDir = path.join(root, "REPORTS", `current-production-rollback-${Date.now()}`);
fs.mkdirSync(path.join(rollbackDir, "app"), { recursive: true });
for (const name of Object.keys(before)) fs.copyFileSync(path.join(production, name), path.join(rollbackDir, "app", name));
const snapshotBackup = {};
const missingSnapshots = [];
for (const file of currentSnapshots) {
  const absolute = path.join(root, file);
  if (fs.existsSync(absolute)) {
    snapshotBackup[file] = fs.readFileSync(absolute).toString("base64");
    fs.mkdirSync(path.join(rollbackDir, path.dirname(file)), { recursive: true });
    fs.copyFileSync(absolute, path.join(rollbackDir, file));
  } else {
    missingSnapshots.push(file);
  }
}
fs.writeFileSync(path.join(rollbackDir, "manifest.json"), JSON.stringify({ files: before, currentProductionManifest: backup.manifest, currentSnapshots: snapshotBackup, missingSnapshots }, null, 2));

const runLifecycle = (script, label, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return result;
};

try {
  for (const name of files) {
    const source = path.join(candidate, name);
    const target = path.join(production, name);
    if (!fs.existsSync(source)) throw new Error(`candidate file is missing: ${name}`);
    if (!fs.existsSync(target)) throw new Error(`production file is missing: ${name}`);
    const current = read(target);
    const incoming = read(source);
    const merged = { ...current };
    for (const key of Object.keys(current)) {
      if (!(key in incoming)) throw new Error(`candidate removed production section ${name}:${key}`);
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) merged[key] = value;
    }
    fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
  }

  if (testMode) {
    console.log(JSON.stringify({ status: "TEST_MODE", note: "snapshot generation intentionally delegated to lifecycle fixture" }));
  } else {
    runLifecycle("scripts/run-validation.mjs", "post-production validation");
    const calculation = spawnSync(process.execPath, ["scripts/run-calculation-equivalence.mjs"], { cwd: root, encoding: "utf8" });
    if (calculation.status !== 0) {
      const calculationReportPath = path.join(root, "validation/calculation-equivalence.json");
      if (!fs.existsSync(calculationReportPath)) {
        throw new Error(`calculation equivalence failed without a report: ${calculation.stdout ?? ""}\n${calculation.stderr ?? ""}`);
      }
      const calculationReport = read(calculationReportPath);
      const mismatches = calculationReport.mismatches ?? [];
      const unexpected = mismatches.filter(
        (mismatch) => !preparedIndicatorIds.has(mismatch.id) || mismatch.field === "plan",
      );
      if (!mismatches.length || unexpected.length) {
        throw new Error(`calculation equivalence has unexpected drift: ${JSON.stringify(unexpected.length ? unexpected : calculationReport)}`);
      }
    }
    runLifecycle("scripts/promote_validation_baseline.mjs", "validation snapshot generation");
    runLifecycle("scripts/promote_calculation_baseline.mjs", "calculation snapshot generation");
    runLifecycle("scripts/run-validation.mjs", "accepted validation snapshot verification", ["--check"]);
    runLifecycle("scripts/run-calculation-equivalence.mjs", "accepted calculation snapshot verification", ["--check"]);
  }

  const promoted = { schemaVersion: 1, kind: "current-production", promotedFrom: candidate, promotedAt: new Date().toISOString(), files: {} };
  for (const name of fs.readdirSync(production).filter((name) => name.endsWith(".json")).sort()) promoted.files[`app/${name}`] = sha256(path.join(production, name));
  for (const file of currentSnapshots) if (fs.existsSync(path.join(root, file))) promoted.files[file] = sha256(path.join(root, file));
  fs.writeFileSync(manifestPath, `${JSON.stringify(promoted, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", promotedFrom: candidate, changedFiles: files, manifest: manifestPath, rollback: rollbackDir }));
} catch (error) {
  const rollbackErrors = [];
  try {
    for (const name of fs.readdirSync(production).filter((name) => name.endsWith(".json"))) {
      if (!(name in backup.files)) fs.rmSync(path.join(production, name), { force: true });
    }
    for (const name of Object.keys(backup.files)) {
      fs.copyFileSync(path.join(rollbackDir, "app", name), path.join(production, name));
    }
    if (backup.manifest === null) fs.rmSync(manifestPath, { force: true });
    else fs.writeFileSync(manifestPath, Buffer.from(backup.manifest, "base64"));
    for (const [file, encoded] of Object.entries(snapshotBackup)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(encoded, "base64"));
    }
    for (const file of missingSnapshots) fs.rmSync(path.join(root, file), { force: true });
    for (const [name, digest] of Object.entries(backup.files)) {
      const target = path.join(production, name);
      if (!fs.existsSync(target) || sha256(target) !== digest) rollbackErrors.push(`hash mismatch: ${name}`);
    }
  } catch (rollbackError) {
    rollbackErrors.push(rollbackError.message);
  }
  if (rollbackErrors.length) {
    throw new Error(`promotion failed: ${error.message}; rollback failed: ${rollbackErrors.join("; ")}`);
  }
  throw new Error(`promotion failed and rollback completed: ${error.message}`);
}
