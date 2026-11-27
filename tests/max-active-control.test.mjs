import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {activeMaxPlanMetric,maxPlanTone} from "../lib/max-active-control.js";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
test("MAX current control excludes reorganized predecessors, preserves source and regional targets",()=>{
 const src=read("app/max-semd40-20261127.json").operational;
 for(const [id,plan,total,excludedPlan] of [["tmk",16000,6654,377],["eln",8000,2030,190]]){
  const before=src.metrics[id], m=activeMaxPlanMetric(before,src.date);
  assert.equal(m.rows.length,83);assert.equal(m.archivedCount,2);assert.equal(m.archivedPlan,excludedPlan);
  assert.equal(m.republicPlan,plan);assert.equal(m.sourceTotal,total);assert.equal(m.plannedMoFact,total);
  assert.equal(m.plannedCoverage.matched,83);assert.equal(m.plannedCoverage.missing,0);
  assert.ok(!m.rows.some(r=>/\.(1107|1146)$/.test(r.oid)));assert.ok(m.rows.some(r=>r.oid.endsWith(".1108")));
  assert.equal(before.rows.length,85);assert.equal(activeMaxPlanMetric(before,src.date,true),before);
  assert.equal(activeMaxPlanMetric(before,"30.09.2026"),before);
 }
 const visits=read("app/max-appointment-plan.json").november;
 const v=activeMaxPlanMetric(visits,"27.11.2026");
 assert.equal(v.rows.length,83);assert.equal(v.plannedMoFact,null);assert.equal(v.republicPlan,visits.republicPlan);
});
test("MAX colors distinguish actual, forecast, no data and boundary values",()=>{
 assert.deepEqual([null,NaN,0,79.99,80,94.99,95,99.99,100,150].map(maxPlanTone),["neutral","neutral","bad","bad","warn","warn","near","near","good","good"]);
 const page=fs.readFileSync("app/page.tsx","utf8");
 assert.match(page,/activeMaxPlanMetric\(maxIndicatorMetricSource/);assert.match(page,/activeMaxPlanMetric\(metricSource/);
 assert.match(page,/maxIndicatorForecastTone/);assert.match(page,/maxIndicatorTempoTone/);
});
