import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync("baseline/manifest.json", "utf8"));
const reference = JSON.parse(fs.readFileSync("baseline/reference-v4.6.0-manifest.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync("baseline/semantic-snapshot.json", "utf8"));
const sha256 = (path) => crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");

test("current baseline lock identifies approved v5.2.1 and its v4.6.0 reference", () => {
  assert.equal(manifest.baselineVersion, "5.2.1");
  assert.equal(manifest.previousBaseline.version, "4.6.0");
  assert.equal(reference.baselineVersion, "4.6.0");
  assert.equal(reference.baselineCommit, "c50be9e1a04b6aa0641e0dd791c2b9238caa15d1");
  assert.equal(reference.handoffZipSha256, "90003a0098165ce484118a8bd661dc03e9471c5759a88dfb5e806800ce7df8b9");
  assert.equal(snapshot.expectedLegacyTests, 47);
});

test("current baseline protected data, rules and state files are byte-locked", () => {
  for (const group of [manifest.protectedData, manifest.protectedRules, manifest.stateFiles]) {
    for (const [path, expected] of Object.entries(group)) {
      assert.ok(fs.existsSync(path), `missing protected file ${path}`);
      assert.equal(sha256(path), expected, `baseline drift in ${path}`);
    }
  }
});

test("historical v4.6.0 manifest remains available as an immutable reference", () => {
  assert.ok(Object.keys(reference.protectedDuringRefactor).length > 0);
  assert.equal(manifest.previousBaseline.manifest, "baseline/reference-v4.6.0-manifest.json");
});

test("baseline semantic anchors preserve approved preventive calculation", () => {
  assert.equal(snapshot.preventiveSemd.status, "ready");
  assert.equal(snapshot.preventiveSemd.numerator, 1557278);
  assert.equal(snapshot.preventiveSemd.denominator, 2036859);
  assert.ok(Math.abs(snapshot.preventiveSemd.share - 76.45487488333754) < 1e-12);
});
