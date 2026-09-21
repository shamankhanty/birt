import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/promote-current-production.mjs");

function fixture(reportOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "promotion-gate-"));
  const production = path.join(root, "app");
  const candidate = path.join(root, "run", "candidate", "app");
  const manifest = path.join(root, "baseline", "current-production-manifest.json");
  fs.mkdirSync(production, { recursive: true });
  fs.mkdirSync(candidate, { recursive: true });
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(path.join(production, "a.json"), JSON.stringify({ kept: 1, changed: "old" }));
  fs.writeFileSync(path.join(production, "b.json"), JSON.stringify({ untouched: true }));
  fs.writeFileSync(path.join(candidate, "a.json"), JSON.stringify({ kept: 1, changed: "new" }));
  fs.writeFileSync(path.join(candidate, "b.json"), JSON.stringify({ untouched: false }));
  fs.writeFileSync(manifest, JSON.stringify({ kind: "before" }));
  const report = {
    state: "PARTIAL",
    statistics: { preparedIndicators: 1 },
    changedFiles: ["a.json"],
    formalValidation: { summary: { FAIL: 0, blocking: 0 } },
    ...reportOverrides,
  };
  fs.writeFileSync(path.join(root, "run", "report.json"), JSON.stringify(report));
  return { root, production, candidate, manifest };
}

function run(item) {
  return spawnSync(process.execPath, [script, "--candidate", item.candidate, "--production", item.production, "--manifest", item.manifest, "--test-mode"], { cwd: item.root, encoding: "utf8" });
}

for (const state of ["PARTIAL", "READY"]) {
  test(`${state} candidate with prepared data and clean validation is accepted selectively`, () => {
    const item = fixture({ state });
    const result = run(item);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(item.production, "a.json"))).changed, "new");
    assert.equal(JSON.parse(fs.readFileSync(path.join(item.production, "b.json"))).untouched, true);
  });
}

for (const formalValidation of [
  { summary: { FAIL: 1, blocking: 0 } },
  { summary: { FAIL: 0, blocking: 1 } },
]) {
  test("FAIL or blocking validation rejects candidate without changing production", () => {
    const item = fixture({ formalValidation });
    const result = run(item);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(item.production, "a.json"))).changed, "old");
  });
}

test("failure after a partial merge restores production and manifest", () => {
  const item = fixture({ changedFiles: ["a.json", "b.json"] });
  fs.writeFileSync(path.join(item.candidate, "b.json"), "not-json");
  const result = run(item);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rollback completed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(item.production, "a.json"))).changed, "old");
  assert.equal(JSON.parse(fs.readFileSync(path.join(item.production, "b.json"))).untouched, true);
  assert.equal(JSON.parse(fs.readFileSync(item.manifest)).kind, "before");
});
