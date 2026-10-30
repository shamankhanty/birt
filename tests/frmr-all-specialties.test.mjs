import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const data=read('app/frmr-all-specialties.json'), links=read('app/frmo-linkage-data.json');
const sum=(rows,i)=>rows.reduce((s,r)=>s+r[i],0);
test('all 8264 positions and all 77 source role names survive aggregation',()=>{
 assert.equal(data.summary.scope,'all_specialties');assert.equal(data.summary.sourceCut,'29.10.2026');assert.equal(data.summary.rows.length,137);
 assert.equal(sum(data.summary.rows,4),8264);assert.equal(sum(data.summary.rows,5),5610);assert.equal(sum(data.summary.rows,6),2654);
 assert.equal(data.departments.roles.length,77);assert.equal(data.records.rows.length,8264);
 assert.equal(data.summary.rows.filter(r=>r[4]>0).length,136);
 assert.deepEqual(data.summary.trend,[['29.10.2026',8264]]);
 for(const r of data.summary.rows){assert.equal(r[2],null);assert.equal(r[3],null);assert.equal(r[7],null);assert.equal(r[4],r[5]+r[6]);assert.equal(r[8].reduce((s,v)=>s+v[1],0),r[4]);}
 assert.ok(data.summary.topSpecialties.some(([r])=>r==='Врач-анестезиолог-реаниматолог'));
 assert.ok(data.summary.topSpecialties.some(([r])=>r==='Медицинский психолог'));
});
test('every staff reference reconciles to its organization, position and exact SP',()=>{
 const by=new Map();
 const nums=new Set();
 for(const [mo,role,sp,last4,issue,row,flags] of data.records.rows){
  assert.ok(data.departments.mos[mo]);assert.ok(data.departments.roles[role]);assert.equal(data.departments.sp[sp][0],mo);
  assert.ok(last4===null||/^\d{4}$/.test(last4));assert.ok(issue===0||issue===1);assert.ok(Number.isInteger(flags));assert.ok(!nums.has(row));nums.add(row);
  const k=[mo,role,sp].join('|');const c=by.get(k)??[0,0];c[issue]++;by.set(k,c);
 }
 assert.equal(Math.min(...nums),3);assert.equal(Math.max(...nums),8266);
 for(const [mo,role,sp,a,b] of data.departments.rows){assert.deepEqual(by.get([mo,role,sp].join('|')),[a,b]);by.delete([mo,role,sp].join('|'));}
 assert.equal(by.size,0);
 for(let mo=0;mo<data.departments.mos.length;mo++){
  const org=data.summary.rows.find(r=>r[0]===data.departments.mos[mo]);assert.ok(org);
  const rec=data.records.rows.filter(r=>r[0]===mo);assert.equal(rec.length,org[4]);assert.equal(rec.filter(r=>r[4]===0).length,org[5]);
 }
});
test('quality annotations preserve source counts without deleting records or exposing identifiers',()=>{
 const rs=data.records.rows;
 assert.equal(rs.filter(r=>r[6]&1).length,4);assert.equal(rs.filter(r=>r[6]&2).length,7);
 assert.equal(rs.filter(r=>r[6]&4).length,23);assert.equal(rs.filter(r=>r[6]&8).length,42);
 assert.equal(data.metadata.quality.repeatedRecordExtras,12);assert.equal(data.metadata.sourceIssueCount,13878);
 assert.doesNotMatch(fs.readFileSync('app/frmr-all-specialties.json','utf8'),/\b\d{11}\b|Фамилия|Дата рождения/iu);
});
test('FRMO computes distinct flagged rows instead of counting source group colors or row totals',()=>{
 assert.equal(links.rows.length,3385);assert.equal(links.rows.filter(r=>r[5]>0).length,2043);assert.equal(links.rows.filter(r=>r[5]===0).length,1342);
 assert.equal(links.totals.sourceSummaryRows,3351);assert.equal(links.totals.missingSummaryRows,34);
 assert.equal(links.organizations.filter(r=>r.summaryMissing).length,8);
 assert.equal(links.organizations.reduce((s,r)=>s+r.rows,0),3385);assert.equal(links.organizations.reduce((s,r)=>s+r.issues,0),2043);
 for(const org of links.organizations){const rows=links.rows.filter(r=>r[0]===org.code);assert.equal(rows.length,org.rows);assert.equal(rows.filter(r=>r[5]>0).length,org.issues);if(!org.summaryMissing)assert.equal(org.sourceSummary,org.rows);}
});
test('every FRMO OID flag is independently reproducible and overlapping reasons do not double-count rows',()=>{
 for(const r of links.rows){const [,,,b,d,flags]=r;
  assert.equal(Boolean(flags&1),!b);assert.equal(Boolean(flags&2),!d);assert.equal(Boolean(flags&4),Boolean(b&&d&&b!==d));
 }
 for(const [bit,count] of Object.entries(links.totals.flagCounts))assert.equal(links.rows.filter(r=>r[5]&Number(bit)).length,count);
 assert.ok(Object.values(links.totals.flagCounts).reduce((s,n)=>s+n,0)>links.totals.issues);
 const spassk=links.organizations.find(r=>r.code==='4001');assert.equal(spassk.parentOids.length,3);
});
test('UI defaults to all specialties while isolating historical comparison and FRMO view',()=>{
 const ui=fs.readFileSync('app/frmr-reconciliation.tsx','utf8');
 assert.match(ui,/useState<"all" \| "legacy">\("all"\)/);assert.match(ui,/Все специальности · 29.10/);assert.match(ui,/Прежний перечень · архив/);assert.match(ui,/view === "linkage" \? <FrmoLinkage/);
 assert.match(ui,/Первая контрольная точка по всем специальностям/);assert.match(ui,/!isAll && <th>Δ<\/th>/);
 assert.doesNotMatch(ui,/\.filter\(.*role.*14/);
});
