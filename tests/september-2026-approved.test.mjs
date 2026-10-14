import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const data=read('app/physician-metrics.json');
test('all eleven September metrics reconcile to source and retain missing data',()=>{
  const expected={doctorsAll:[10674,13542],doctorsLevel3:[3801,4815],doctor500_obgyn:[238,413],doctor500_gp:[263,302],doctor500_cardiologist:[116,206],doctor500_oncologist:[144,232],doctor500_ophthalmologist:[119,234],doctor500_pediatrician:[833,1357],doctor500_dentist:[152,652],doctor500_therapist:[861,1386],doctor500_surgeon:[137,277]};
  for(const [id,[num,den]] of Object.entries(expected)){
    const d=data.datasets[id];
    assert.equal(d.period,'сентябрь 2026'); assert.equal(d.date,'30.09.2026');
    assert.equal(d.summary.numerator,num); assert.equal(d.summary.denominator,den);
    assert.equal(d.rows.reduce((s,r)=>s+(r.count??0),0),num);
    assert.equal(d.rows.reduce((s,r)=>s+(r.volume??0),0),den);
    for(const r of d.rows.filter(r=>r.sourceStatus==='no_source_row')){assert.equal(r.fact,null);assert.equal(r.count,null);}
  }
  const first=data.datasets.doctorsAll.rows.find(r=>r.oid==='1.2.643.5.1.13.13.12.2.16.1163');
  assert.equal(first.count,952); assert.equal(first.volume,1055);
});
test('approved MBT 37–39 preserve independent cumulative period and plans',()=>{
  const rows=read('app/federal-control.json').agreement;
  for(const [id,n] of [['37',2258],['38',14399],['39',1308250]]){
    const r=rows.find(r=>r.id===id);
    assert.equal(Number(r.regionalFact.replace(/\D/g,'')),n);
    assert.equal(r.regionalPeriod,'01.01–13.10.2026');
    assert.equal(r.status,'Достигнут');assert.equal(r.regionalManualStatus,'achieved');assert.equal(r.plan,'Да');
  }
});
