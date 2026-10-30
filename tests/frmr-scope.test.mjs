import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyFrmrScope, frmrExclusionReason } from '../lib/frmr-scope.js';
const source = JSON.parse(fs.readFileSync('app/frmr-all-specialties.json', 'utf8'));
test('approved scope exceptions preserve source and reconcile every visible total', () => {
 const before = JSON.stringify(source);
 const {data, excluded} = applyFrmrScope(source);
 assert.deepEqual(excluded, {ambulance:886,trainee:129,laboratory:313,total:1328});
 assert.equal(data.records.rows.length,6936);assert.equal(JSON.stringify(source),before);
 assert.equal(data.records.rows.length+excluded.total,8264);
 assert.equal(data.summary.rows.reduce((n,r)=>n+r[4],0),6936);
 assert.equal(data.summary.rows.reduce((n,r)=>n+r[5],0),4393);
 assert.equal(data.summary.rows.reduce((n,r)=>n+r[6],0),2543);
 assert.equal(data.departments.rows.reduce((n,r)=>n+r[3]+r[4],0),6936);
 assert.equal(data.summary.topSpecialties.reduce((n,r)=>n+r[1],0),6936);
 for(let mo=0;mo<data.departments.mos.length;mo++){
  const org=data.summary.rows.find(r=>r[0]===data.departments.mos[mo]);
  assert.equal(org[4],data.records.rows.filter(r=>r[0]===mo).length);
  assert.equal(org[4],org[8].reduce((n,r)=>n+r[1],0));
 }
 const groups=new Map();
 for(const r of data.records.rows){
  assert.equal(frmrExclusionReason(data.departments.roles[r[1]],data.departments.sp[r[2]][2]),null);
  const k=r.slice(0,3).join(':');const c=groups.get(k)??[0,0];c[r[4]]++;groups.set(k,c);
 }
 for(const [mo,role,sp,a,b] of data.departments.rows)assert.deepEqual(groups.get([mo,role,sp].join(':')),[a,b]);
 assert.deepEqual(data.summary.trend,[['29.10.2026',6936]]);
 assert.equal(data.summary.rows.filter(r=>r[4]>0).length,136);
});
test('exceptions are narrow: retain independent doctors, biologists, FAP staff and urgent outpatient care',()=>{
 for(const [role,sp] of [['Врач-бактериолог','Клинико-диагностическая лаборатория'],['Биолог','Клинико-диагностическая лаборатория'],['Фельдшер','Фельдшерско-акушерский пункт'],['Врач-терапевт','Отделение неотложной медицинской помощи']])assert.equal(frmrExclusionReason(role,sp),null);
 for(const [role,sp,why] of [['Врач-стажёр','Поликлиника','trainee'],['Медицинский лабораторный техник','Поликлиника','laboratory'],['Старший фельдшер-лаборант','КДЛ','laboratory'],['Фельдшер скорой медицинской помощи','Амбулатория','ambulance'],['Фельдшер','Станция скорой медицинской помощи','ambulance'],['Врач-анестезиолог-реаниматолог','Специализированная выездная бригада скорой медицинской помощи анестезиологии-реанимации','ambulance']])assert.equal(frmrExclusionReason(role,sp),why);
});
test('overview and MO diagnostics share the filtered dataset while archive and FRMO remain separate',()=>{
 const ui=fs.readFileSync('app/frmr-reconciliation.tsx','utf8');
 for(const part of ['summary','departments','records'])assert.ok(ui.includes(`isAll ? scopedAll.${part}`));
 assert.match(ui,/Изменение охвата не является улучшением показателя/);
 assert.match(ui,/view === "linkage" \? <FrmoLinkage/);
});
