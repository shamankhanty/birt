import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read = name => JSON.parse(fs.readFileSync('app/'+name+'.json','utf8'));
const mo=read('mo-data'), monthly=read('monthly-mo'), op=read('operational-mo');
const views=read('max-period-views'), doctors=read('physician-metrics'), weekly=read('physician-weekly-snapshot');
const evidence=JSON.parse(fs.readFileSync('docs/update-20261102-evidence.json','utf8'));
test('November source dates are explicit; the closed October month remains separate',()=>{
  for(const id of ['tvspAmbulatory','tvspStationary','tvspLaboratory']){
    assert.equal(mo[id].date,'05.11.2026');
    assert.equal(mo[id].period,'январь–ноябрь 2026');
    assert.equal(read('unit-data')[id].date,'05.11.2026');
  }
  for(const id of ['egpu','egpu2days','hospital','birth','smp'])assert.equal(mo[id].date,'04.11.2026');
  for(const id of ['shortInput','shortInputAmb','shortInputHosp'])assert.equal(op[id].date,'04.11.2026');
});
test('closed October physician month is retained beside the partial November operational period',()=>{
  assert.equal(doctors.period,'октябрь 2026');
  assert.equal(doctors.formed,'31.10.2026');
  assert.equal(weekly.period,'01.11.2026–04.11.2026');
  for(const [id,ds] of Object.entries(doctors.datasets)){
    assert.equal(ds.period,'октябрь 2026',id);
    assert.equal(ds.date,'31.10.2026',id);
    assert.equal(weekly.previousPeriods[id].period,'01.10.2026–31.10.2026',id);
    assert.equal(monthly[id].currentLabel,'Октябрь 2026',id);
    for(const row of ds.rows){
      if(row.count!==null && row.volume>0)assert.ok(Math.abs(row.fact-row.count/row.volume*100)<1e-9,id+' '+row.name);
    }
  }
});
test('MAX retains separate October and current cumulative source totals, without adding them',()=>{
  assert.equal(views.cumulative.date,'31.10.2026');
  assert.equal(views.closedMonths['2026-10'].operational.date,'31.10.2026');
  for(const [service,total,monthlyTotal,metric] of [['tmk',74774,15573,'tmkMaxCount'],['eln',55899,12498,'elnMaxCount']]){
    assert.equal(op[metric].date,'04.11.2026');
    assert.equal(views.closedMonths["2026-10"].operational.metrics[service].sourceTotal,monthlyTotal);
    assert.equal(op[metric].rows.reduce((sum,r)=>sum+(r.count??0),0),total);
    assert.equal(views.cumulative.metrics[service].rows.length,85);
    assert.equal(views.closedMonths["2026-10"].operational.metrics[service].rows.length,85);
  }
});
test('REMD errors preserve separate periods, with no invented denominator',()=>{
  const brief=read('error-categories'),cum=read('error-cumulative'),byMo=read('error-organizations');
  assert.equal(brief.total,114916);assert.equal(cum.total,14523993);
  assert.equal(brief.period,'31.10.2026–05.11.2026');
  assert.equal(cum.period,'01.01.2026–04.11.2026');
  assert.equal(brief.share,null);assert.equal(cum.share,null);
  assert.equal(brief.items.reduce((sum,x)=>sum+x.count,0),brief.total);
  assert.equal(cum.items.reduce((sum,x)=>sum+x.count,0),cum.total);
  assert.equal(byMo.totalErrors,brief.total);
});
test('SEMD summary reconciles 97 document types and current source evidence',()=>{
  const s=read('semd-summary');assert.equal(s.total,84817652);
  assert.equal(s.registeredTypes,97);
  assert.equal(s.items.reduce((sum,x)=>sum+x.count,0),s.total);
  assert.equal(evidence.sourceCount,22);
  assert.ok(evidence.retained.some(x=>x.indicator==='semd228'));
  assert.ok(evidence.retained.some(x=>x.indicator==='ambulatoryCase'));
  assert.ok(evidence.retained.some(x=>x.indicator==='death'));
});

test('October gaps are explicitly marked retained, not counted as current monthly results',()=>{
 for(const id of ['death','semd228','ambulatoryCase']){
  assert.equal(monthly[id].ratingState,'retained_incomplete_period',id);
  assert.notEqual(monthly[id].currentLabel,'Октябрь 2026',id);
 }
});

test('completed October TVSP snapshots are monthly, not provisional or operational-only',()=>{
 for(const id of ['tvspStationary','tvspAmbulatory','tvspDiagnostic','tvspLaboratory']){
  assert.equal(monthly[id].currentLabel,'На 31.10',id);
  assert.equal(monthly[id].periodKind,'cumulative',id);
  assert.equal(monthly[id].periodStatus,'closed_month_end',id);
  assert.ok(monthly[id].rows.length>0);
  assert.ok(mo[id].date.endsWith('.11.2026'));
 }
});
