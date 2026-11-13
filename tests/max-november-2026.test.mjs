import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const views=read('app/max-period-views.json');
const previousViews=read('baseline/archive/pre-20261113/app/max-period-views.json');
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
 assert.equal(views.operational.period,'01.11–13.11.2026');
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

test('MAX November uses the direct report and attributes the parent row to the planned Spassk branch',()=>{
 const previousSource=read('docs/update-20261109-max-november-direct.json');
 const evidence=read('docs/intake-20261113-evidence.json');
 const operational=views.operational;
 assert.equal(operational.status,'partial_month_source');
 assert.equal(operational.date,'13.11.2026');
 assert.equal(operational.previousDate,previousViews.operational.date);
 assert.equal(operational.previousPeriod,previousViews.operational.period);
 assert.equal(operational.previousSource,previousViews.operational.source);
 assert.ok(evidence.sources.some(source=>source.name===operational.source && source.periodKind==='monthly' && source.endDate==='2026-11-13'));
 for(const id of ['tmk','eln']){
  assert.equal(views.cumulative.metrics[id].sourceTotal,previousViews.cumulative.metrics[id].sourceTotal);
  assert.equal(views.closedMonths['2026-10'].cumulative.metrics[id].sourceTotal,previousViews.closedMonths['2026-10'].cumulative.metrics[id].sourceTotal);
  assert.equal(views.closedMonths['2026-10'].operational.metrics[id].sourceTotal,previousViews.closedMonths['2026-10'].operational.metrics[id].sourceTotal);
 }
 for(const [id,region,inPlan,previousInPlan,dgbFact,spasskFact,spasskPrevious] of [['tmk',4832,2024,1995,0,36,7],['eln',3578,1927,1926,3,2,1]]){
  const metric=operational.metrics[id];
  const previousByOid=new Map(previousViews.operational.metrics[id].rows.map(row=>[row.oid,row.fact]));
  assert.equal(metric.sourceTotal,region);
  assert.equal(metric.plannedMoFact,inPlan);
  assert.equal(metric.factStatus,'partial_november_source');
  assert.equal(metric.previousSourceTotal,previousSource.totals[id]);
  assert.equal(metric.previousPlannedMoFact,previousInPlan);
  assert.equal(metric.rows.reduce((sum,row)=>sum+(row.fact??0),0),inPlan);
  assert.ok(metric.rows.filter(row=>!row.oid.endsWith('.18650')).every(row=>row.previous===previousByOid.get(row.oid)));
  assert.equal(metric.rows.filter(row=>row.fact===null).length,2);
  assert.equal(metric.rows.find(row=>row.oid.endsWith('.1146')).fact,null);
  const spassk=metric.rows.find(row=>row.oid.endsWith('.18650'));
  assert.equal(spassk.fact,spasskFact);
  assert.equal(spassk.previous,spasskPrevious);
  assert.equal(metric.rows.find(row=>row.oid.endsWith('.1148')).fact,dgbFact);
  assert.equal(metric.rows.filter(row=>row.fact!==null).reduce((sum,row)=>sum+(row.previous??0),0),previousInPlan);
 }
 assert.deepEqual(
  ['tmk','eln'].map(id=>views.cumulative.metrics[id].rows.find(row=>row.oid.endsWith('.18650')).fact),
  [1302,37],
 );
 assert.deepEqual(
  ['tmk','eln'].map(id=>views.closedMonths['2026-10'].cumulative.metrics[id].rows.find(row=>row.oid.endsWith('.18650')).fact),
  [1295,36],
 );
 assert.equal(views.nextCumulativeTarget.fact,null);
});

test('UI derives the MAX source dates and enables November forecasts from comparable cuts',()=>{
 assert.match(page,/maxControlMonth/);
 assert.match(page,/Октябрь · закрыт/);
 assert.match(page,/Ноябрь · план/);
 assert.match(page,/Оперативный факт получен напрямую из месячной выгрузки за \$\{maxIndicatorSlice.period\}/u);
 assert.match(page,/Накопительный факт подтверждён по отчёту за \$\{maxIndicatorSlice.period\}/u);
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
