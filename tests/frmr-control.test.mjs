import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyFrmrScope} from '../lib/frmr-scope.js';import {frmrControlView} from '../lib/frmr-control.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const raw=read('app/frmr-all-specialties.json'),types=read('app/frmr-sp-types.json');
const {data,excluded}=applyFrmrScope(raw,types.types);
const sum=(rows,i)=>rows.reduce((n,r)=>n+r[i],0);
function check(d){
 assert.equal(sum(d.summary.rows,4),d.records.rows.length);
 assert.equal(sum(d.summary.rows,5)+sum(d.summary.rows,6),d.records.rows.length);
 assert.equal(d.departments.rows.reduce((n,r)=>n+r[3]+r[4],0),d.records.rows.length);
 assert.equal(sum(d.summary.topSpecialties,1),d.records.rows.length);
 for(let mo=0;mo<d.departments.mos.length;mo++){
  const row=d.summary.rows.find(r=>r[0]===d.departments.mos[mo]);
  const records=d.records.rows.filter(r=>r[0]===mo);
  assert.equal(row[4],records.length);assert.equal(row[4],sum(row[8],1));
  for(const [role,n] of row[8])assert.equal(records.filter(r=>d.departments.roles[r[1]]===role).length,n);
 }
 const groups=new Map();for(const r of d.records.rows){const k=r.slice(0,3).join(':');const n=groups.get(k)??[0,0];n[r[4]]++;groups.set(k,n);}
 for(const [mo,role,sp,a,b] of d.departments.rows)assert.deepEqual(groups.get([mo,role,sp].join(':')),[a,b]);
}
test('SP types are source-backed and cover every OID without name guessing',()=>{
 assert.deepEqual(types.source,raw.metadata.source);assert.deepEqual(types.ambiguousOids,[]);
 for(const [mo,suffix] of raw.departments.sp)assert.ok(types.types['1.2.643.5.1.13.13.12.2.16.'+raw.departments.mos[mo]+'.0.'+suffix]);
 assert.equal(Object.keys(types.types).length,1642);
 assert.deepEqual(excluded,{ambulance:845,trainee:127,laboratory:307,total:1279});assert.equal(data.records.rows.length,6247);
});
test('MO is the default; SP references are disjoint and never inflate the main total',()=>{
 const before=JSON.stringify(data);const mo=frmrControlView(data),sp=frmrControlView(data,'department');
 assert.equal(mo.records.rows.length,3922);assert.equal(sp.records.rows.length,2325);
 assert.equal(mo.summary.rows.filter(r=>r[4]>0).length,123);assert.equal(sp.summary.rows.filter(r=>r[4]>0).length,113);
 assert.ok(mo.records.rows.every(r=>r[4]===0));assert.ok(sp.records.rows.every(r=>r[4]===1));
 const ids=new Set(mo.records.rows.map(r=>r[5]));assert.ok(sp.records.rows.every(r=>!ids.has(r[5])));
 assert.equal(ids.size+sp.records.rows.length,6247);check(mo);check(sp);assert.equal(JSON.stringify(data),before);
});
test('every SP type partitions both control levels and preserves administrative and diagnostic staff',()=>{
 for(const level of ['mo','department']){
  let n=0;
  for(const type of new Set(Object.values(types.types))){const d=frmrControlView(data,level,type,types.types);check(d);n+=d.records.rows.length;}
  assert.equal(n,frmrControlView(data,level).records.rows.length);
  assert.equal(frmrControlView(data,level,'Скорая медицинская помощь',types.types).records.rows.length,0);
  assert.ok(frmrControlView(data,level,'Административно-хозяйственный (вспомогательный)',types.types).records.rows.length>0);
  assert.ok(frmrControlView(data,level,'Лабораторно-диагностический',types.types).records.rows.length>0);
 }
});
test('unavailable type stays explicit and all records remain reachable without the type filter',()=>{
 const oid=Object.keys(types.types)[0];const partial={...types.types};delete partial[oid];
 const d=frmrControlView(data,'mo','Не указан',partial);check(d);
 assert.equal(frmrControlView(data,'mo','nonexistent',types.types).records.rows.length,0);
 assert.throws(()=>frmrControlView(data,'both'),/Unknown/);
});

