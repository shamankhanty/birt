import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const data=JSON.parse(fs.readFileSync(new URL('../app/unit-data.json',import.meta.url)));
test('nontransmitting OIDs match mandatory count minus passing count for every detailed object',()=>{
  for(const[id,total]of [['tvspAmbulatory',79],['tvspStationary',112],['tvspLaboratory',0]]){
    let count=0;
    for(const r of data[id].rows){
      assert.ok(Array.isArray(r.missingUnitOids));
      assert.equal(r.missingUnitOids.length,r.plannedSubunits-r.registeredSubunits);
      assert.equal(new Set(r.missingUnitOids).size,r.missingUnitOids.length);
      const planned=new Set(r.unitOid.split(',').map(v=>v.trim()));
      assert.ok(r.missingUnitOids.every(oid=>planned.has(oid)));
      count+=r.missingUnitOids.length;
    }
    assert.equal(count,total,id);
  }
});
test('GP21 has only three and four nontransmitting OIDs in the affected buildings',()=>{
  const rows=data.tvspAmbulatory.rows.filter(r=>r.moOid==='1.2.643.5.1.13.13.12.2.16.1179');
  assert.deepEqual(rows.find(r=>r.buildingIds==='101896').missingUnitOids.map(x=>x.split('.').at(-1)),['734924','980367','980372']);
  assert.deepEqual(rows.find(r=>r.buildingIds==='28544').missingUnitOids.map(x=>x.split('.').at(-1)),['402111','735135','743003','883022']);
});
test('accepted facts, plans, dates and previous object metadata stay unchanged',()=>{
  const copy=structuredClone(data);for(const d of Object.values(copy))for(const r of d.rows)delete r.missingUnitOids;
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex'),'331c92be1161b68fdea2e8b6c637b8b9f06b3c83e0af4371deb6308a308303a2');
});
test('building-only sources do not invent nontransmitting SP identifiers',()=>{
  for(const id of ['tvspDiagnostic','smpFederal'])assert.ok(data[id].rows.every(r=>r.missingUnitOids===undefined));
});
