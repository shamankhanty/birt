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
 assert.equal(oct.operational.metrics.tmk.sourceTotal,16224);
 assert.equal(oct.operational.metrics.eln.sourceTotal,12590);
 assert.equal(oct.operational.metrics.tmk.republicPlan,16000);
 assert.equal(oct.operational.metrics.eln.republicPlan,8000);
 assert.equal(oct.cumulative.metrics.tmk.sourceTotal,73479);
 assert.equal(oct.cumulative.metrics.eln.sourceTotal,55268);
 assert.equal(views.cumulative.date,'08.11.2026');
 assert.equal(views.cumulative.previousDate,'31.10.2026');
 assert.equal(views.cumulative.metrics.tmk.sourceTotal,76211);
 assert.equal(views.cumulative.metrics.eln.sourceTotal,56941);
 assert.equal(views.cumulative.metrics.tmk.republicPlan,177000);
 assert.equal(views.cumulative.metrics.eln.republicPlan,90000);
 assert.notDeepEqual(views.cumulative,oct.cumulative);
});

test('MAX November plan uses November-minus-October approved targets, not old 2026 year-end plan',()=>{
 assert.equal(views.monthLabel,'Ноябрь 2026');
 assert.equal(views.operational.period,'01.11–08.11.2026');
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

test('MAX November uses 94 direct monthly source rows for 01–08.11 without subtracting cumulative',()=>{
 const source=read('docs/update-20261109-max-november-direct.json');
 assert.equal(views.operational.status,'partial_month_source');
 assert.equal(views.operational.date,'08.11.2026');
 assert.equal(views.operational.previousDate,null);
 assert.ok(views.operational.source.includes('01.11-08.11.xlsx'));
 assert.equal(source.sourceRows,94);
 assert.equal(source.alignedSourceRows,97);
 const pairs=source.rows.split(';').map(item=>item==='-'?[null,null]:item.split('/').map(Number));
 assert.equal(pairs.length,97);
 assert.deepEqual(source.missingSourceIndexes,[1,94,96]);
 for(const [id,idx,region,inPlan,missingCount] of [['tmk',0,2006,1988,2],['eln',1,1939,1925,2]]){
   const metric=views.operational.metrics[id];
   assert.equal(pairs.reduce((sum,p)=>sum+(p[idx]??0),0),region);
   assert.equal(metric.sourceTotal,region);
   assert.equal(metric.plannedMoFact,inPlan);
   assert.equal(metric.factStatus,'partial_november_source');
   assert.equal(metric.previousSourceTotal,null);
   assert.equal(metric.previousPlannedMoFact,null);
   assert.equal(metric.rows.length,85);
   assert.equal(metric.rows.filter(row=>row.fact===null).length,missingCount);
   assert.equal(metric.rows.reduce((sum,row)=>sum+(row.fact??0),0),inPlan);
   assert.ok(metric.rows.every(row=>row.previous===null));
   assert.equal(metric.rows.find(row=>row.oid.endsWith('.1146')).fact,null);
   assert.equal(metric.rows.find(row=>row.oid.endsWith('.1148')).fact,pairs[26][idx]);
   assert.ok(metric.rows.find(row=>row.oid==='1.2.643.5.1.13.13.12.2.16.18650').fact===null);
 }
 assert.equal(views.cumulative.metrics.tmk.sourceTotal,76211);
 assert.equal(views.cumulative.metrics.eln.sourceTotal,56941);
 assert.equal(views.cumulative.metrics.tmk.previousSourceTotal,74208);
 assert.equal(views.cumulative.metrics.eln.previousSourceTotal,55268);
 assert.equal(views.nextCumulativeTarget.fact,null);
});

test('UI shows confirmed November direct and cumulative facts; monthly forecast waits for a second cut',()=>{
 assert.match(page,/maxControlMonth/);
 assert.match(page,/Октябрь · закрыт/);
 assert.match(page,/Ноябрь · план/);
 assert.match(page,/Оперативный факт получен напрямую из месячной выгрузки 01–08.11.2026/u);
 assert.match(page,/Накопительный факт подтверждён на 08.11.2026/u);
 assert.match(page,/maxIndicatorAchievement === null \? "Нет данных"/u);
 assert.match(page,/maxIndicatorFact !== null/u);
 assert.match(page,/maxIndicatorForecast/u);
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
