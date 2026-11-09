import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildSeptemberRating, calculateSeptemberOrganization} from "../lib/september-rating.js";
import {buildOctoberRating} from "../lib/october-rating.js";
import {applyPediatricTherapistReferencePolicy, isPediatricRatingOrganization} from "../lib/pediatric-rating-policy.js";
import {excludeMonthlyRatingBranches, monthlyRatingBranchKeys} from "../lib/monthly-rating-scope.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const inputs = read("app/rating/september-v2-inputs.json");
const old = read("app/rating/september-v1.json");
const policy = read("config/september-rating-v2.json");
const datasets = {...read("app/monthly-mo.json"), ...read("app/monthly-2026-10.json")};
const branchKeys = monthlyRatingBranchKeys(read("app/mo-registry.json"), read("config/rkb-spassk-branch.json"));
const eligibleInputs = {...inputs, organizations: excludeMonthlyRatingBranches(inputs.organizations, branchKeys)};
const eligibleOld = {...old, rows: excludeMonthlyRatingBranches(old.rows, branchKeys)};
const september = buildSeptemberRating(eligibleInputs, eligibleOld, policy);
const october = buildOctoberRating(eligibleInputs, datasets, policy);
const byEnd = suffix => dataset => dataset.find(row => row.key.endsWith(suffix));

test("both child MOs with a therapist 500+ entry are reference only in both months", () => {
  const affected = inputs.organizations.filter(org => isPediatricRatingOrganization(org) &&
    org.metrics.some(metric => metric.id === "doctor500_therapist"));
  assert.deepEqual(affected.map(x => x.key.slice(-4)).sort(), ["1065", "1148"]);
  for (const dataset of [september, october]) for (const suffix of [".1148", ".1065"]) {
    const row = byEnd(suffix)(dataset);
    const metric = row.metrics.find(m => m.id === "doctor500_therapist");
    assert.equal(metric.status, "reference_only");
    assert.equal(metric.numerator, 0);
    assert.equal(metric.denominator, 1);
    assert.equal(metric.fact, 0);
    assert.match(metric.reason, /Справочно: терапевты 500\+/);
    assert.ok(!row.missing.some(m => m.id === "doctor500_therapist"));
    assert.equal(row.total, row.metrics.filter(m => m.status !== "not_applicable" && m.status !== "reference_only").length);
    assert.equal(row.available, row.metrics.filter(m => m.status === "available").length);
    assert.ok(row.complete && row.place >= 1);
  }
});

test("reference metrics never lower child rating scores or inflate coverage denominator", () => {
  for (const dataset of [september, october]) {
    for (const suffix of [".1148", ".1065"]) {
      const rated = byEnd(suffix)(dataset);
      const rawMetric = rated.metrics.find(m => m.id === "doctor500_therapist");
      const ifRated = calculateSeptemberOrganization({
        ...rated,
        metrics: rated.metrics.map(m => m.id === "doctor500_therapist" ?
          {...m, status: "available", reason: null} : m),
      }, policy);
      assert.ok(rated.score > ifRated.score, rated.name + " should not lose points for an inapplicable therapist score");
      assert.equal(rated.total, ifRated.total - 1);
      assert.equal(rated.available, ifRated.available - 1);
    }
  }
});

test("pediatric scope is by MO profile and explicit pediatric identifiers, never by rating group alone", () => {
  const rows = [
    {name: "ДГБ № 1 г.Казань", type: "Детские городские поликлиники"},
    {name: "ДГП № 2 г.Казань", type: "Детские городские поликлиники"},
    {name: "ДРКБ МЗ РТ", type: "Республиканские и специализированные МО"},
    {name: "КДМЦ г.Наб.Челны", type: "Центральные районные больницы"},
    {name: "ДСП № 1 г.Казань", type: "Стоматологические поликлиники"},
  ];
  assert.ok(rows.every(isPediatricRatingOrganization));
  assert.equal(isPediatricRatingOrganization({name:"РКБ МЗ РТ",type:"Республиканские и специализированные МО"}),false);
  assert.equal(isPediatricRatingOrganization({name:"Камская районная больница",type:"Центральные районные больницы"}),false);
});

test("adult 500+ therapist remains scored and approved September inputs are not edited", () => {
  const adult = eligibleInputs.organizations.find(org => org.metrics.some(m => m.id === "doctor500_therapist" && m.status === "available")
    && !isPediatricRatingOrganization(org));
  assert.ok(adult);
  const original = adult.metrics.find(m => m.id === "doctor500_therapist");
  assert.equal(applyPediatricTherapistReferencePolicy(adult), adult);
  for (const dataset of [september, october]) {
    const row = dataset.find(r => r.key === adult.key);
    assert.equal(row.metrics.find(m => m.id === "doctor500_therapist").status, "available");
  }
  assert.equal(original.status, "available");
  for (const suffix of [".1148",".1065"]) {
    const source = inputs.organizations.find(org => org.key.endsWith(suffix)).metrics.find(m => m.id === "doctor500_therapist");
    assert.equal(source.status, "available", "September source remains unchanged");
    assert.deepEqual([source.numerator, source.denominator], [0,1]);
  }
});

test("missing pediatric therapist source cannot deny official place or enter mandatory denominator", () => {
  const source = {
    ...eligibleInputs.organizations.find(org => org.key.endsWith(".1148")),
    metrics: [
      {id:"doctor500_therapist",name:"Доля врачей-терапевтов",status:"missing",family:"500",block:"readiness",fact:null,numerator:null,denominator:null,plan:50},
      {id:"doctor500_pediatrician",name:"Педиатры",status:"available",family:"500",block:"readiness",fact:60,numerator:3,denominator:5,plan:50},
    ],
  };
  const transformed = applyPediatricTherapistReferencePolicy(source);
  const result = calculateSeptemberOrganization(transformed, policy);
  assert.equal(result.complete,true);
  assert.equal(result.total,1);
  assert.equal(result.missing.length,0);
  assert.equal(result.score,100);
});

test("rating UI exposes source ratios and reference status, while September v1 archive remains unmodified", () => {
  const ui = fs.readFileSync("app/september-rating.tsx","utf8");
  assert.match(ui,/m\.status==='reference_only'/);
  assert.match(ui,/m\.numerator!==null&&m\.denominator!==null/);
  assert.match(ui,/терапевты 500\+ показываются только справочно/);
  assert.equal(old.rows.find(x=>x.key.endsWith(".1148")).details.find(m=>m.id==="doctor500_therapist").score,0);
});
