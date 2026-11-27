import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const next=read('app/max-semd40-20261127.json'), old=read('app/max-period-views.json');
test('MAX SEMD40 source totals, plan rows, comparable cuts and archive',()=>{
assert.equal(next.operational.date,'27.11.2026');assert.equal(next.operational.previousDate,'20.11.2026');
assert.equal(old.operational.date,'23.11.2026');
for(const [id,p,c] of [['tmk',5305,6654],['eln',1603,2030]]){
const m=next.operational.metrics[id], a=old.operational.metrics[id];
assert.equal(m.sourceTotal,c);assert.equal(m.previousSourceTotal,p);assert.equal(m.republicPlan,a.republicPlan);assert.equal(m.rows.length,85);
assert.equal(m.plannedMoFact,m.rows.reduce((s,r)=>s+(r.fact??0),0));assert.equal(m.previousPlannedMoFact,m.rows.reduce((s,r)=>s+(r.previous??0),0));
assert.deepEqual(m.rows.map(r=>[r.oid,r.plan]),a.rows.map(r=>[r.oid,r.plan]));assert.ok(m.rows.every(r=>r.previous===null||r.fact===null||r.fact>=r.previous));
assert.equal(m.rows.find(r=>r.oid.endsWith('.1146')).fact,null);
}
const page=fs.readFileSync('app/page.tsx','utf8');assert.match(page,/max-archive-toggle/);assert.match(page,/maxSemd40Raw.operational/);assert.match(page,/Накопительный факт ожидается/);
});
