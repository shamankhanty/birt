import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyFrmrScope} from '../lib/frmr-scope.js';import {frmrControlView,compareFrmrControl} from '../lib/frmr-control.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const raw=read('app/frmr-all-specialties.json'),types=read('app/frmr-sp-types.json'),previous=read('app/frmr-previous-control.json');
const data=applyFrmrScope(raw,types.types).data;
test('26 November uses its dated column and preserves 19 November as the comparable cut',()=>{
 assert.equal(raw.summary.sourceCut,'26.11.2026');assert.equal(raw.metadata.parsedRows,6581);assert.equal(raw.metadata.nonProblemRows,18902);assert.equal(raw.metadata.summaryCountColumn,19);
 assert.equal(previous.cut,'19.11.2026');assert.equal(previous.rows.reduce((n,r)=>n+r[4],0),5628);
 assert.equal(raw.metadata.source.sha256,'642064d7e63f838186379d9ff77cc61e0a5a325c7e1d000401e7131c57f83c8a');
 assert.equal(raw.metadata.sourceIssueCount,10995);assert.equal(raw.records.rows.length,6581);
});
test('same rules and OIDs yield 3427 to 3358 and 2201 to 2054; every organization matches',()=>{
 for(const [level,old,n] of [['mo',3427,3358],['department',2201,2054]]){
  const current=frmrControlView(data,level),c=compareFrmrControl(previous,current,level);
  assert.equal(c.previousTotal,old);assert.equal(c.currentTotal,n);assert.equal(c.comparableOrganizations,135);assert.equal(c.missingBaseline,0);
  const stage=level==='mo'?0:1;
  for(const r of current.summary.rows)assert.equal(c.byMo[r[0]],previous.rows.filter(p=>p[0]===r[0]&&p[3]===stage).reduce((n,p)=>n+p[4],0));
 }
});
test('type-filtered comparisons use the same source type on both dates',()=>{
 for(const level of ['mo','department'])for(const type of new Set(Object.values(types.types))){
  const current=frmrControlView(data,level,type,types.types);const c=compareFrmrControl(previous,current,level,type);
  assert.equal(c.previousTotal,previous.rows.filter(r=>r[2]===type&&r[3]===(level==='mo'?0:1)).reduce((n,r)=>n+r[4],0));assert.equal(c.currentTotal,current.records.rows.length);
 }
});
test('new or absent organizations cannot silently become zero previous values',()=>{
 const current=frmrControlView(data);const custom={...current,summary:{...current.summary,rows:[...current.summary.rows,['new','New MO',null,null,7,7,0,null,[]]]}};
 const c=compareFrmrControl(previous,custom);assert.equal(c.byMo.new,null);assert.equal(c.missingBaseline,1);assert.equal(c.currentTotal,3358);
 const first=current.summary.rows[0][0];const restricted={...previous,organizations:[first],rows:previous.rows.filter(r=>r[0]===first)};
 const d=compareFrmrControl(restricted,current);assert.equal(d.comparableOrganizations,1);assert.equal(d.missingBaseline,134);assert.equal(d.currentTotal,current.summary.rows[0][4]);
});

