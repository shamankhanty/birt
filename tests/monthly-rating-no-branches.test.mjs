import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildSeptemberRating} from "../lib/september-rating.js";
import {buildOctoberRating} from "../lib/october-rating.js";
import {
  isMonthlyBranchName,
  monthlyRatingBranchKeys,
  excludeMonthlyRatingBranches,
} from "../lib/monthly-rating-scope.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const inputs = read("app/rating/september-v2-inputs.json");
const legacy = read("app/rating/september-v1.json");
const registry = read("app/mo-registry.json");
const spassk = read("config/rkb-spassk-branch.json");
const policy = read("config/september-rating-v2.json");
const keys = monthlyRatingBranchKeys(registry, spassk);
const eligibleInputs = {...inputs, organizations: excludeMonthlyRatingBranches(inputs.organizations, keys)};
const eligibleLegacy = {...legacy, rows: excludeMonthlyRatingBranches(legacy.rows, keys)};
const excluded = inputs.organizations.filter(row => !eligibleInputs.organizations.some(org => org.key === row.key));

test("monthly ranking excludes 12 named affiliates and confirmed RKB branch Spassk", () => {
  assert.equal(inputs.organizations.length, 124);
  assert.equal(excluded.length, 13);
  assert.equal(eligibleInputs.organizations.length, 111);
  assert.equal(eligibleLegacy.rows.length, 111);
  assert.ok(excluded.some(row => row.key === "context:spassk-crb"));
  assert.equal(excluded.filter(row => isMonthlyBranchName(row.name)).length, 12);
  for (const row of excluded) assert.ok(keys.has(row.key) || isMonthlyBranchName(row.name));
  assert.ok(!eligibleInputs.organizations.some(row => row.key === "context:spassk-crb"));
});

test("head organizations and similarly named independent entities remain", () => {
  for (const name of ["РКБ МЗ РТ", "РКНД МЗ РТ г.Казань", "ДРКБ МЗ РТ"]) {
    assert.ok(eligibleInputs.organizations.some(row => row.name === name), name);
  }
  assert.ok(!keys.has("1.2.643.5.1.13.13.12.2.16.1094"), "Do not exclude RKB parent");
  assert.equal(isMonthlyBranchName("ФИЛИАЛ  РКПД г.Нижнекамск"), true);
  assert.equal(isMonthlyBranchName("Республиканский филиал школы"), false);
});

test("September and October ranks only count eligible medical organizations", () => {
  const september = buildSeptemberRating(eligibleInputs, eligibleLegacy, policy);
  const october = buildOctoberRating(eligibleInputs, {
    ...read("app/monthly-mo.json"),
    ...read("app/monthly-2026-10.json"),
  }, policy);
  for (const dataset of [september, october]) {
    assert.equal(dataset.length, 111);
    assert.ok(dataset.every(row => !keys.has(row.key) && !isMonthlyBranchName(row.name)));
    for (const type of new Set(dataset.map(row => row.type))) {
      const official = dataset.filter(row => row.type === type && row.complete);
      if (official.length) assert.equal(Math.min(...official.map(row => row.place)), 1);
    }
  }
});

test("hiding branches does not change scores, source components, or historical files", () => {
  const original = buildSeptemberRating(inputs, legacy, policy);
  const eligible = buildSeptemberRating(eligibleInputs, eligibleLegacy, policy);
  const originalByKey = new Map(original.map(row => [row.key, row]));
  for (const row of eligible) {
    const old = originalByKey.get(row.key);
    assert.equal(row.score, old.score, row.name);
    assert.equal(row.oldScore, old.oldScore, row.name);
    assert.deepEqual(row.metrics, old.metrics, row.name);
  }
});

test("all three monthly rating editions apply scope before ranking and displaying totals", () => {
  const page = fs.readFileSync("app/page.tsx", "utf8");
  const rating = fs.readFileSync("app/september-rating.tsx", "utf8");
  assert.match(page, /excludeMonthlyRatingBranches\(\s*septemberRatingArchive\.rows/);
  assert.match(page, /buildUnionRating\(ratingRows\)/);
  assert.match(rating, /organizations: excludeMonthlyRatingBranches\(inputs\.organizations/);
  assert.match(rating, /rows: excludeMonthlyRatingBranches\(legacy\.rows/);
  assert.match(rating, /buildOctoberRating\(eligibleInputs/);
  assert.match(rating, /buildSeptemberRating\(eligibleInputs,eligibleLegacy/);
  assert.match(page, /филиалы не представлены отдельными МО/);
});
