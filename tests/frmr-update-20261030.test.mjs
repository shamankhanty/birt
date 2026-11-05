import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyFrmrScope} from '../lib/frmr-scope.js';import {frmrControlView,compareFrmrControl} from '../lib/frmr-control.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const raw=read('app/frmr-all-specialties.json'),types=read('app/frmr-sp-types.json'),previous=read('app/frmr-previous-control.json');
const data=applyFrmrScope(raw,types.types).data;
test('5 November uses its dated column and preserves the immediately previous comparable cut',()=>{
 assert.equal(raw.summary.sourceCut,'05.11.2026');assert.equal(raw.metadata.parsedRows,7526);assert.equal(raw.metadata.nonProblemRows,17879);assert.equal(raw.metadata.summaryCountColumn,19);
 assert.equal(previous.cut,'30.10.2026');assert.equal(previous.rows.reduce((n,r)=>n+r[4],0),6737);
 assert.equal(raw.metadata.source.sha256,'a67e78e289e9f02debce5fccc91110948fe62d6984d8e3df8f9f698c12914d21');
 assert.equal(raw.metadata.sourceIssueCount,12614);assert.equal(raw.records.rows.length,7526);
});
test('same rules and OIDs yield 4262 to 3922 and 2475 to 2325; every organization matches',()=>{
 for(const [level,old,n] of [['mo',4262,3922],['department',2475,2325]]){
  const current=frmrControlView(data,level),c=compareFrmrControl(previous,current,level);
  assert.equal(c.previousTotal,old);assert.equal(c.currentTotal,n);assert.equal(c.comparableOrganizations,137);assert.equal(c.missingBaseline,0);
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
 const c=compareFrmrControl(previous,custom);assert.equal(c.byMo.new,null);assert.equal(c.missingBaseline,1);assert.equal(c.currentTotal,3922);
 const first=current.summary.rows[0][0];const restricted={...previous,organizations:[first],rows:previous.rows.filter(r=>r[0]===first)};
 const d=compareFrmrControl(restricted,current);assert.equal(d.comparableOrganizations,1);assert.equal(d.missingBaseline,136);assert.equal(d.currentTotal,current.summary.rows[0][4]);
});

