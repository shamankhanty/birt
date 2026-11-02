import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {maxHearingPlan} from '../lib/max-hearing-plan.js';
const targets=JSON.parse(fs.readFileSync('config/max-targets-2026.json','utf8'));
test('hearing MAX plans use exact approved MO OIDs and the month of the cumulative fact',()=>{
 for(const [oid,row] of Object.entries(targets.organizationPlans))for(const [id,service] of [['tmkMaxCount','tmk'],['elnMaxCount','eln']])for(const month of targets.months){
  const [y,m]=month.split('-'),date=`28.${m}.${y}`;const actual=maxHearingPlan(targets,id,oid,date,`01.01–${date}`);
  assert.equal(actual.plan,row[service][month]);assert.equal(actual.assigned,true);assert.match(actual.label,new RegExp(`\\.${m}\\.${y}`));
 }
 const oid='1.2.643.5.1.13.13.12.2.16.1153';assert.equal(maxHearingPlan(targets,'tmkMaxCount',oid,'28.10.2026','01.01–28.10.2026').plan,1508);
 assert.equal(maxHearingPlan(targets,'elnMaxCount',oid,'28.10.2026','01.01–28.10.2026').plan,768);
});
test('monthly facts, missing control points and unknown OIDs never inherit a regional or guessed plan',()=>{
 const oid='1.2.643.5.1.13.13.12.2.16.1153';
 assert.equal(maxHearingPlan(targets,'tmkMaxCount',oid,'28.10.2026','01.10–28.10.2026').plan,null);
 assert.equal(maxHearingPlan(targets,'tmkMaxCount',oid,'28.10.2026','01.01–25.10.2026').plan,null);
 assert.equal(maxHearingPlan(targets,'tmkMaxCount',oid,'28.08.2026','01.01–28.08.2026').plan,null);
 assert.equal(maxHearingPlan(targets,'tmkMaxCount','unknown','28.10.2026','01.01–28.10.2026').assigned,false);
 assert.equal(maxHearingPlan(targets,'tmkMaxCount',oid,'31.02.2026','01.01–31.02.2026').plan,null);
 assert.equal(maxHearingPlan(targets,'other',oid,'28.10.2026','01.01–28.10.2026'),null);
});
test('hearing profiles resolve MAX applicability from approved plans without changing priority weights',()=>{
 const page=fs.readFileSync('app/page.tsx','utf8'),policy=JSON.parse(fs.readFileSync('app/hearing-priority-policy.json','utf8'));
 assert.match(page,/maxHearingPlan\(maxTargets, id, registry.oid, dataset.date/);
 assert.match(page,/maxPlan \? maxPlan.assigned : applicableForRegistry/);
 assert.match(page,/planLabel: maxPlan\?\.label/);
 assert.match(page,/status: maxPlan \? "reference"/);
 assert.match(page,/affectsPriority: isOperationalMetric && plan !== null/);
 assert.ok(!JSON.stringify(policy.blocks).includes('tmkMaxCount'));assert.ok(!JSON.stringify(policy.blocks).includes('elnMaxCount'));
});
