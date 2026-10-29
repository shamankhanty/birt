import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { createIndicatorCalculationRuntime } from '../lib/calculation-engine.js';

// Exercise the same module and parameters used by the real sidebar and summary.
const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'current-card-audit-'));
const target = path.join(tmp, 'runtime.mjs');
await build({stdin:{contents:fs.readFileSync(path.join(root,'app/page.tsx'),'utf8') + '\nexport { calculatedIndicatorById, unitData, assessFederalPlan, federalLowerIsBetter, federalControl, regionalControlStatus };',loader:'tsx',resolveDir:path.join(root,'app')},bundle:true,platform:'node',format:'esm',outfile:target,logLevel:'silent'});
const runtime = await import(pathToFileURL(target));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('all five object indicators use current object components, date and exact fact',()=>{
  assert.equal(Object.keys(runtime.unitData).length,5);
  for(const[id,u]of Object.entries(runtime.unitData)){
    const item=runtime.calculatedIndicatorById[id];
    assert.equal(item.fact,u.fact/u.plan*100,id);
    assert.equal(item.quantity,u.fact,id);
    assert.equal(item.calculation.denominator,u.plan,id);
    assert.equal(item.date,u.date,id);
    const row=runtime.federalControl.collegium.find(r=>r.regionalId===id);
    const assessment=runtime.assessFederalPlan(row);
    assert.equal(assessment.zone==='achieved',u.fact>=u.plan,id);
    assert.equal(assessment.volume,`${new Intl.NumberFormat('ru-RU').format(u.fact)} из ${new Intl.NumberFormat('ru-RU').format(u.plan)}`,id);
  }
});
test('90 percent minimum cannot classify 84.57 percent as achieved',()=>{
  const row=runtime.federalControl.agreement.find(r=>r.id==='16');
  assert.equal(runtime.federalLowerIsBetter(row),false);
  assert.equal(runtime.assessFederalPlan(row).zone,'lag');
  for(const plan of ['не менее 90%','НЕ МЕНЕЕ 90%','≥ 90%'])assert.equal(runtime.federalLowerIsBetter({...row,plan}),false);
  for(const plan of ['не более 5%','≤ 5%','менее 5%'])assert.equal(runtime.federalLowerIsBetter({...row,name:'Доля',plan}),true);
});
test('all 69 card zones and current status agree, including manual and missing facts',()=>{
  const rows=['agreement','collegium'].flatMap(set=>runtime.federalControl[set].filter(r=>r.type!=='Компонент'));
  assert.equal(rows.length,69);
  for(const row of rows){
    const a=runtime.assessFederalPlan(row), status=runtime.regionalControlStatus(row);
    assert.equal(status==='achieved',a.zone==='achieved',row.name);
    if(a.score!==null)assert.equal(a.zone==='achieved',a.score>=100,row.name);
    if(a.volume&&a.zone==='achieved')assert.equal(a.shortage,0,row.name);
  }
  assert.equal(runtime.regionalControlStatus(runtime.federalControl.agreement.find(r=>r.id==='10')),'achieved');
  assert.equal(runtime.regionalControlStatus(runtime.federalControl.agreement.find(r=>r.id==='22')),'notAchieved');
});
test('unavailable object components stay missing instead of using old percentage or zero',()=>{
  const runtime=createIndicatorCalculationRuntime({staticIndicators:[{id:'kdl',fact:96.83,plan:100}],unitData:{kdl:{fact:null,plan:125,date:'29.10.2026'}}});
  assert.equal(runtime.byId.kdl.fact,null);
  assert.equal(runtime.byId.kdl.quantity,null);
});
