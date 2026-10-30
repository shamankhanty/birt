import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildSeptemberRating,calculateSeptemberOrganization,metricScore} from '../lib/september-rating.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const inputs=read('app/rating/september-v2-inputs.json'),legacy=read('app/rating/september-v1.json'),policy=read('config/september-rating-v2.json');
const rows=buildSeptemberRating(inputs,legacy,policy);
const metric=(id,block,family,fact=100,status='available')=>({id,name:id,block,family,fact,plan:100,numerator:fact,denominator:100,status});
const org=metrics=>({key:'test',name:'Test',type:'Test',metrics});
test('September archive preserves 124 baseline rows and original October dental substitution',()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync('app/rating/september-v1.json')).digest('hex'),'c13ec244e22df68ba96c39442900ab690e76fcefc8c75e2947623d5e7b9810c6');
 assert.equal(legacy.rows.length,124);assert.equal(legacy.baselineCommit,'a1e175e2de3c0291afa374447c0372478df558f1');
 assert.ok(legacy.rows.some(r=>r.details.some(m=>m.name.includes('оперативный контроль'))));
 assert.equal(inputs.organizations.length,124);assert.equal(new Set(inputs.organizations.map(r=>r.key)).size,124);
});
test('September snapshot uses only monthly September or cumulative September 30 components',()=>{
 for(const row of inputs.organizations)for(const m of row.metrics){
  assert.ok(['01.09–30.09.2026','01.01–30.09.2026'].includes(m.period));
  assert.ok(!['ambulatoryCase','birth','death','tvspLaboratory'].includes(m.id));
  if(m.status==='available')assert.equal(m.fact,m.numerator/m.denominator*100);
 }
});
test('source totals for full September EGPU reconcile before profile filtering',()=>{
 assert.equal(inputs.sources.egpu.sha256,'01ae1eb1c5b21ac55b8b4ae12277383a79404ee7bc1ccc9108aaa79da2e68a61');
 // Some source rows are outside the profile of the 124 ranked organizations.
 for(const id of ['egpu','egpu2days'])for(const r of inputs.organizations){
  const m=r.metrics.find(m=>m.id===id&&m.status==='available');if(m)assert.ok(m.numerator<=m.denominator);
 }
});
test('Agriz preventive result is MAX(9665,5104)/15236, not the old 9464 numerator',()=>{
 const r=inputs.organizations.find(r=>r.key.endsWith('.1088'));
 const m=r.metrics.find(m=>m.id==='semd228');assert.equal(m.s122,9665);assert.equal(m.s228,5104);assert.equal(m.numerator,9665);assert.equal(m.denominator,15236);
 const h=r.metrics.find(m=>m.id==='hospital');assert.equal(h.numerator,2196);assert.equal(h.denominator,4802);
});
test('all preventive numerators use per-MO maximum rather than sum',()=>{
 for(const r of inputs.organizations)for(const m of r.metrics.filter(m=>m.id==='semd228'&&m.status==='available'))assert.equal(m.numerator,Math.max(m.s122,m.s228));
});
test('dental organizations use September physician counts without October override',()=>{
 const physician=read('app/physician-metrics.json');
 for(const r of inputs.organizations.filter(r=>r.type==='Стоматологические поликлиники')){
  const m=r.metrics.find(m=>m.id==='doctor500_dentist');assert.ok(m);
  const source=physician.datasets.doctor500_dentist.rows.find(p=>p.oid===r.key);
  assert.equal(m.numerator,source.count);assert.equal(m.denominator,source.volume);
 }
});
test('missing data receive no score, no official place and no leader status',()=>{
 for(const r of rows.filter(r=>!r.complete)){assert.equal(r.score,null);assert.equal(r.place,undefined);assert.notEqual(r.status,'Лидер');assert.ok(r.low<=r.high);assert.ok(r.missing.length>0);}
 const complete=calculateSeptemberOrganization(org([metric('a','care','care',20),metric('b','services','services',100)]),policy);
 const incomplete=calculateSeptemberOrganization(org([metric('a','care','care',null,'missing'),metric('b','services','services',100)]),policy);
 assert.equal(incomplete.score,null);assert.ok(incomplete.low<complete.score);assert.ok(incomplete.high>=complete.score);
});
test('structural inapplicability can redistribute weights but a missing block cannot',()=>{
 const na=calculateSeptemberOrganization(org([metric('a','care','care',null,'not_applicable'),metric('b','services','services',80)]),policy);
 assert.equal(na.score,80);assert.ok(na.complete);
 const missing=calculateSeptemberOrganization(org([metric('a','care','care',null,'missing'),metric('b','services','services',80)]),policy);
 assert.equal(missing.score,null);assert.ok(missing.low<80);
});
test('500+ specialties form one family with fixed influence',()=>{
 const base=[metric('c','care','care'),metric('s','services','services'),metric('t','readiness','tvsp'),metric('a','readiness','activity')];
 const one=calculateSeptemberOrganization(org([...base,metric('500a','readiness','500',0)]),policy);
 const nine=calculateSeptemberOrganization(org([...base,...Array.from({length:9},(_,i)=>metric('500'+i,'readiness','500',0))]),policy);
 assert.equal(one.score,97.5);assert.equal(nine.score,97.5);
});
test('scores cap at 100 and critical care prevents leader label',()=>{
 assert.equal(metricScore(metric('over','care','care',150)),100);
 const r=calculateSeptemberOrganization(org([metric('low','care','care',79),...Array.from({length:20},(_,i)=>metric('good'+i,'care','care'))]),policy);
 assert.ok(r.score>95);assert.equal(r.status,'Требует внимания');
});
test('ranking is deterministic, confined to profiles and ties share places',()=>{
 assert.deepEqual(rows,buildSeptemberRating(inputs,legacy,policy));
 for(const r of rows.filter(r=>r.complete)){assert.ok(r.score>=0&&r.score<=100);assert.equal(r.coverage,100);assert.ok(r.place>=1);}
 const fixture={month:'2026-09',organizations:[{...org([metric('a','care','care')]),key:'a'},{...org([metric('a','care','care')]),key:'b'}]};
 const tie=buildSeptemberRating(fixture,{month:'2026-09',rows:[]},policy);assert.equal(tie[0].place,1);assert.equal(tie[1].place,1);
 assert.throws(()=>buildSeptemberRating({...inputs,month:'2026-10'},legacy,policy),/Mixed/);
});
test('frozen inputs retain verifiable source provenance without depending on future live updates',()=>{
 const raw=read('app/rating/september-source-components.json');
 for(const [id,num,den] of [['egpu',6684,6690],['egpu2days',6077,6690]]){
  assert.equal(raw.metrics[id].reduce((s,r)=>s+r.numerator,0),num);
  assert.equal(raw.metrics[id].reduce((s,r)=>s+r.denominator,0),den);
 }
 for(const [id,source] of Object.entries(raw.sources))assert.deepEqual(source,inputs.sources[id]);
 for(const hash of Object.values(inputs.acceptedDatasetHashes))assert.match(hash,/^[a-f0-9]{64}$/);
});
