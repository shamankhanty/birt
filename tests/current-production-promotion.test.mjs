import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const copyTree = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const name of fs.readdirSync(from)) fs.copyFileSync(path.join(from, name), path.join(to, name)); };

test("promotion advances current snapshot while historical baseline remains byte-identical", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "current-production-promotion-"));
  const app = path.join(temp, "app"); const candidate = path.join(temp, "candidate", "app"); const baseline = path.join(temp, "baseline");
  copyTree("app", app); copyTree("app", candidate); fs.mkdirSync(baseline, { recursive: true });
  const historical = ["baseline/reference-v4.6.0-manifest.json", "baseline/semantic-snapshot.json", "baseline/calculation-runtime-snapshot.json", "baseline/mo-registry-runtime-snapshot.json"].map((file) => [file, sha(file)]);
  const report = { state: "PARTIAL", statistics: { preparedIndicators: 27, retainedInvalidIndicators: 2, missingSourceIndicators: 5 }, unknownSources: [{}, {}, {}, {}, {}, {}, {}], changedFiles: ["operational-mo.json"], formalValidation: { summary: { FAIL: 0, blocking: 0 } } };
  fs.writeFileSync(path.join(temp, "report.json"), JSON.stringify(report));
  const data = JSON.parse(fs.readFileSync(path.join(candidate, "operational-mo.json"), "utf8")); data.__promotionProbe = { date: "17.09.2026" }; fs.writeFileSync(path.join(candidate, "operational-mo.json"), JSON.stringify(data, null, 2));
  const manifest = path.join(baseline, "current-production-manifest.json"); fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, kind: "current-production", files: {} }));
  const run = spawnSync(process.execPath, ["scripts/promote-current-production.mjs", "--candidate", candidate, "--production", app, "--manifest", manifest, "--test-mode"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(app, "operational-mo.json"), "utf8")).__promotionProbe.date, "17.09.2026");
  for (const [file, digest] of historical) assert.equal(sha(file), digest, `${file} changed`);
  assert.equal(JSON.parse(fs.readFileSync(manifest, "utf8")).kind, "current-production");
});

test("read-only post-transfer verification does not change CURRENT artifacts after manifest finalization", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "current-production-verification-"));
  fs.mkdirSync(path.join(temp, "baseline"), { recursive: true });
  fs.mkdirSync(path.join(temp, "validation"), { recursive: true });
  fs.writeFileSync(path.join(temp, "validation", "validation-report.json"), JSON.stringify({ dataDate: "17.09.2026", overallStatus: "PASS" }));
  fs.writeFileSync(path.join(temp, "baseline", "calculation-runtime-snapshot.json"), JSON.stringify({ current: "17.09.2026" }));
  const current = ["validation/validation-report.json", "baseline/calculation-runtime-snapshot.json"];
  const files = Object.fromEntries(current.map(file => [file, sha(path.join(temp, file))]));
  const manifest = path.join(temp, "baseline", "current-production-manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ kind: "current-production", files }));
  const before = sha(manifest);
  const run = spawnSync(process.execPath, ["scripts/verify-current-production.mjs", "--root", temp, "--manifest", manifest], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(sha(manifest), before);
  for (const file of current) assert.equal(sha(path.join(temp, file)), files[file], `${file} changed during verification`);
});
