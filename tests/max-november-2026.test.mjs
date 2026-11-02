import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const views=read('app/max-period-views.json');
const targets=read('config/max-targets-2026.json');
const report=read('app/month-closure-2026-10.json');
const page=fs.readFileSync('app/page.tsx','utf8');

test('MAX October is closed with original source facts and no changes to October plan',()=>{
 assert.equal(views.month,'2026-11');
 const oct=views.closedMonths['2026-10'];
 assert.equal(oct.status,'closed');
 assert.equal(oct.operational.date,'31.10.2026');
 assert.equal(oct.operational.metrics.tmk.sourceTotal,15573);
 assert.equal(oct.operational.metrics.eln.sourceTotal,12498);
 assert.equal(oct.operational.metrics.tmk.republicPlan,16000);
 assert.equal(oct.operational.metrics.eln.republicPlan,8000);
 assert.equal(oct.cumulative.metrics.tmk.sourceTotal,73479);
 assert.equal(oct.cumulative.metrics.eln.sourceTotal,55268);
 assert.equal(views.cumulative.date,'31.10.2026');
 assert.deepEqual(views.cumulative,oct.cumulative);
});

test('MAX November plan uses November-minus-October approved targets, not old 2026 year-end plan',()=>{
 assert.equal(views.monthLabel,'Ноябрь 2026');
 assert.equal(views.operational.period,'01.11–30.11.2026');
 for(const [id,monthlyPlan,cumulative] of [['tmk',16000,177000],['eln',8000,90000]]){
  const metric=views.operational.metrics[id];
  assert.equal(metric.republicPlan,monthlyPlan);
  assert.equal(metric.cumulativeTarget,cumulative);
  assert.equal(cumulative,targets.republic[id]['2026-11']);
  assert.equal(monthlyPlan,cumulative-targets.republic[id]['2026-10']);
  assert.equal(metric.rows.length,85);
  for(const row of metric.rows){
   const plan=targets.organizationPlans[row.oid];
   assert.ok(plan,'unknown plan OID '+row.oid);
   assert.equal(row.plan,plan[id]['2026-11']-plan[id]['2026-10']);
  }
 }
});

test('November source has not arrived: not even one fabricated fact or forecast',()=>{
 assert.equal(views.operational.status,'awaiting_first_source');
 assert.equal(views.operational.source,null);
 assert.equal(views.operational.date,null);
 for(const metric of Object.values(views.operational.metrics)){
  assert.equal(metric.sourceTotal,null);
  assert.equal(metric.plannedMoFact,null);
  assert.equal(metric.previousPlannedMoFact,null);
  assert.equal(metric.factStatus,'awaiting_november_source');
  assert.ok(metric.rows.every(r=>r.fact===null&&r.previous===null));
 }
 assert.equal(views.nextCumulativeTarget.fact,null);
});

test('UI offers frozen October vs November with no-data status, and separate cumulative October',()=>{
 assert.match(page,/maxControlMonth/);
 assert.match(page,/Октябрь · закрыт/);
 assert.match(page,/Ноябрь · план/);
 assert.match(page,/Ноябрьская выгрузка пока отсутствует/);
 assert.match(page,/Ноябрьский факт не поступал/);
 assert.match(page,/maxIndicatorAchievement === null \? "Нет данных"/);
 assert.match(page,/maxIndicatorFact !== null/);
});

test('source-routing policy keeps current October closed-month measures and incomplete sources separate',()=>{
 assert.ok(report.closedMonthly.includes('tvspStationary'));
 assert.ok(report.closedMonthly.includes('tvspAmbulatory'));
 assert.ok(report.closedMonthly.includes('tvspDiagnostic'));
 assert.ok(report.closedMonthly.includes('tvspLaboratory'));
 assert.ok(report.retained.includes('semd228'));
 assert.ok(report.retained.includes('ambulatoryCase'));
 assert.ok(report.retained.includes('death'));
 assert.ok(report.operationalOnly.includes('shortInput'));
 assert.equal(report.maxNovember.factStatus,'not_provided');
});
