import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read = name => JSON.parse(fs.readFileSync('app/'+name+'.json','utf8'));
const mo=read('mo-data'), monthly=read('monthly-mo'), op=read('operational-mo');
const views=read('max-period-views'), doctors=read('physician-metrics'), weekly=read('physician-weekly-snapshot');
const evidence=JSON.parse(fs.readFileSync('docs/update-20261102-evidence.json','utf8'));
test('October source metadata is explicit; export on 02 Nov is not reporting in November',()=>{
  for(const id of ['tvspAmbulatory','tvspStationary','tvspLaboratory']){
    assert.equal(mo[id].date,'31.10.2026');
    assert.equal(mo[id].period,'январь–октябрь 2026');
    assert.equal(read('unit-data')[id].date,'31.10.2026');
  }
  for(const id of ['egpu','egpu2days','hospital','birth','smp'])assert.equal(mo[id].date,'31.10.2026');
  for(const id of ['shortInput','shortInputAmb','shortInputHosp'])assert.equal(op[id].date,'28.10.2026');
});
test('October physician month is self-consistent in the two reporting stores',()=>{
  assert.equal(doctors.period,'октябрь 2026');
  assert.equal(doctors.formed,'31.10.2026');
  assert.equal(weekly.period,'01.10.2026–31.10.2026');
  for(const [id,ds] of Object.entries(doctors.datasets)){
    assert.equal(ds.period,'октябрь 2026',id);
    assert.equal(ds.date,'31.10.2026',id);
    assert.equal(weekly.periods[id].period,'01.10.2026–31.10.2026',id);
    assert.equal(monthly[id].currentLabel,'Октябрь 2026',id);
    for(const row of ds.rows){
      if(row.count!==null && row.volume>0)assert.ok(Math.abs(row.fact-row.count/row.volume*100)<1e-9,id+' '+row.name);
    }
  }
});
test('MAX retains separate October and cumulative source totals, without adding them',()=>{
  assert.equal(views.cumulative.date,'31.10.2026');
  assert.equal(views.operational.date,'31.10.2026');
  for(const [service,total,monthlyTotal,metric] of [['tmk',73479,15573,'tmkMaxCount'],['eln',55268,12498,'elnMaxCount']]){
    assert.equal(views.cumulative.metrics[service].sourceTotal,total);
    assert.equal(views.operational.metrics[service].sourceTotal,monthlyTotal);
    assert.equal(op[metric].rows.reduce((sum,r)=>sum+(r.count??0),0),total);
    assert.equal(views.cumulative.metrics[service].rows.length,85);
    assert.equal(views.operational.metrics[service].rows.length,85);
  }
});
test('REMD errors preserve separate periods, with no invented denominator',()=>{
  const brief=read('error-categories'),cum=read('error-cumulative'),byMo=read('error-organizations');
  assert.equal(brief.total,303938);assert.equal(cum.total,14433785);
  assert.equal(brief.period,'22.10.2026–31.10.2026');
  assert.equal(cum.period,'01.01.2026–31.10.2026');
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
