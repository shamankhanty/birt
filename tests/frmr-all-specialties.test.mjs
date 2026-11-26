import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const data=read('app/frmr-all-specialties.json');
const links=read('app/frmo-linkage-data-20261126.json');
const audit=read('app/frmr-sp-audit-20261126.json');
const sum=(rows,i)=>rows.reduce((s,r)=>s+r[i],0);
test('26 November source preserves all 6,581 problem positions and all 76 role names',()=>{
 assert.equal(data.summary.scope,'all_specialties');assert.equal(data.summary.sourceCut,'26.11.2026');assert.equal(data.summary.rows.length,135);
 assert.equal(sum(data.summary.rows,4),6581);assert.equal(sum(data.summary.rows,5),4410);assert.equal(sum(data.summary.rows,6),2171);
 assert.equal(data.departments.roles.length,76);assert.equal(data.records.rows.length,6581);
 assert.deepEqual(data.summary.trend,[['26.11.2026',6581]]);
 assert.equal(data.metadata.summaryCountColumn,19);assert.equal(data.metadata.sourceIssueCount,10995);
 for(const r of data.summary.rows){assert.equal(r[2],null);assert.equal(r[3],null);assert.equal(r[7],null);assert.equal(r[4],r[5]+r[6]);assert.equal(r[8].reduce((s,v)=>s+v[1],0),r[4]);}
 assert.ok(data.summary.topSpecialties.some(([r])=>r==='Врач-анестезиолог-реаниматолог'));
 assert.ok(data.summary.topSpecialties.some(([r])=>r==='Медицинский психолог'));
});
test('every staff reference reconciles to its organization, position and exact SP',()=>{
 const by=new Map();const nums=new Set();
 for(const [mo,role,sp,last4,issue,row,flags] of data.records.rows){
  assert.ok(data.departments.mos[mo]);assert.ok(data.departments.roles[role]);assert.equal(data.departments.sp[sp][0],mo);
  assert.ok(last4===null||/^\d{4}$/.test(last4));assert.ok(issue===0||issue===1);assert.ok(Number.isInteger(flags));assert.ok(!nums.has(row));nums.add(row);
  const k=[mo,role,sp].join('|');const c=by.get(k)??[0,0];c[issue]++;by.set(k,c);
 }
 assert.equal(Math.min(...nums),4);assert.equal(Math.max(...nums),25485);
 for(const [mo,role,sp,a,b] of data.departments.rows){assert.deepEqual(by.get([mo,role,sp].join('|')),[a,b]);by.delete([mo,role,sp].join('|'));}
 assert.equal(by.size,0);
 for(let mo=0;mo<data.departments.mos.length;mo++){
  const org=data.summary.rows.find(r=>r[0]===data.departments.mos[mo]);assert.ok(org);
  const rec=data.records.rows.filter(r=>r[0]===mo);assert.equal(rec.length,org[4]);assert.equal(rec.filter(r=>r[4]===0).length,org[5]);
 }
});
test('source annotations retain all records and export no direct personal identifiers',()=>{
 const rs=data.records.rows;
 assert.equal(rs.filter(r=>r[6]&1).length,4);assert.equal(rs.filter(r=>r[6]&2).length,0);
 assert.equal(rs.filter(r=>r[6]&4).length,20);assert.equal(rs.filter(r=>r[6]&8).length,7);
 assert.equal(data.metadata.quality.repeatedRecordExtras,10);
 assert.doesNotMatch(fs.readFileSync('app/frmr-all-specialties.json','utf8'),/\b\d{11}\b|Фамилия|Дата рождения/iu);
});
test('FRMO flags are recomputable, overlapping reasons do not double-count rows, and missing summary codes stay explicit',()=>{
 assert.equal(links.cut,'26.11.2026');assert.equal(links.rows.length,2690);
 assert.equal(links.totals.issues,1683);assert.equal(links.totals.consistent,1007);
 assert.equal(links.totals.sourceSummaryRows,2664);assert.equal(links.totals.missingSummaryRows,26);assert.equal(links.totals.missingSummaryCodes,9);
 assert.equal(links.organizations.length,150);assert.equal(links.organizations.filter(r=>r.detailMissing).length,19);assert.equal(links.organizations.filter(r=>r.summaryMissing).length,9);assert.equal(links.organizations.reduce((s,r)=>s+r.rows,0),2690);
 assert.equal(links.organizations.reduce((s,r)=>s+r.issues,0),1683);
 for(const r of links.rows){const [,,,b,d,flags]=r;
  assert.equal(Boolean(flags&1),!b);assert.equal(Boolean(flags&2),!d);assert.equal(Boolean(flags&4),Boolean(b&&d&&b!==d));
 }
 for(const [bit,count] of Object.entries(links.totals.flagCounts))assert.equal(links.rows.filter(r=>r[5]&Number(bit)).length,count);
 assert.ok(Object.values(links.totals.flagCounts).reduce((s,n)=>s+n,0)>links.totals.issues);
});
test('26 November FRMO cut stays separated from historical source cuts and personal data',()=>{
 assert.equal(audit.sourceCut,'26.11.2026');assert.equal(audit.previousCut,'20.11.2026');assert.equal(audit.historicCut,'19.10.2026');
 assert.equal(audit.records.length,2690);assert.equal(audit.summary.length,150);assert.equal(audit.summarySourceCount,141);
 assert.equal(audit.summary.filter(m=>m.current===null).length,9);
 assert.equal(audit.summary.filter(m=>!m.hasDetail).length,19);
 assert.doesNotMatch(fs.readFileSync('app/frmr-sp-audit-20261126.json','utf8'),/\b\d{11}\b|Фамилия|Дата рождения/iu);
});
test('UI uses the new dated cuts and keeps exception semantics',()=>{
 const ui=fs.readFileSync('app/frmr-reconciliation.tsx','utf8');
 assert.match(ui,/frmoAudit\.sourceCut/);assert.match(ui,/Все специальности ·/);
 assert.doesNotMatch(ui,/Прежний перечень · архив/);
 assert.match(ui,/Сравнение \{comparisonOverview\.cut\}/);assert.match(ui,/<th>Δ<\/th>/);
 assert.match(fs.readFileSync('app/frmo-linkage.tsx','utf8'),/frmo-linkage-data-20261126/);
});
