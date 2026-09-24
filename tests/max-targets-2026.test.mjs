import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const targets = JSON.parse(fs.readFileSync("config/max-targets-2026.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

test("MAX target documents preserve separate RT plans and MO control points", () => {
  assert.deepEqual(targets.months, ["2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(targets.republic.tmk, { "2026-09": 145000, "2026-10": 161000, "2026-11": 177000, "2026-12": 193000 });
  assert.deepEqual(targets.republic.eln, { "2026-09": 74000, "2026-10": 82000, "2026-11": 90000, "2026-12": 99000 });
  assert.equal(targets.validation.sourceOrganizationRows, 85);
  assert.equal(targets.validation.noRedistribution, true);
  assert.ok(Object.keys(targets.organizationPlans).length > 60);
  assert.ok(Object.values(targets.organizationPlans).every((row) => row.oid && Object.keys(row.tmk).length === 4 && Object.keys(row.eln).length === 4));
  assert.match(page, /max-targets-2026\.json/u);
  assert.match(page, /data-testid="max-target-control"/u);
});

test("MAX target calculations never use a combined TMK plus ELN value", () => {
  assert.match(page, /maxTargets\.republic\[maxService === "tmk" \? "tmk" : "eln"\]/u);
  assert.doesNotMatch(page, /tmk.*\+.*eln|eln.*\+.*tmk/u);
});
