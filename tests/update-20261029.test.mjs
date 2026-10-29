import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const evidence=read('docs/update-20261029-evidence.json');
const mo=read('app/mo-data.json');

test('29 October archive covers 21 sources and 32 successfully staged indicators',()=>{
 assert.equal(Object.keys(evidence.sourceFiles).length,21);
 assert.equal(evidence.statistics.preparedIndicators,32);
 assert.equal(evidence.statistics.retainedInvalidIndicators,0);
 assert.equal(evidence.statistics.missingSourceIndicators,4);
 assert.deepEqual(evidence.retained.map(x=>x.metric).sort(),['electronicWaybill','shortInput','shortInputAmb','shortInputHosp'].sort());
});
test('latest cumulative source components keep their exact source cuts',()=>{
 for(const [id,n,d,date]of [['egpu',43190,43662,'28.10.2026'],['egpu2days',36924,43662,'28.10.2026'],['hospital',721270,790387,'27.10.2026'],['ambulatoryCase',13163346,14291248,'27.10.2026'],['semd228',2163037,2393314,'28.10.2026'],['birth',26541,26575,'28.10.2026'],['death',33618,34048,'28.10.2026'],['smp',734399,777781,'28.10.2026']]){
  assert.deepEqual([mo[id].numerator,mo[id].denominator,mo[id].date],[n,d,date],id);
 }
});
test('weekly and cumulative REMD errors share a cutoff but remain independent',()=>{
 const w=read('app/error-categories.json'),c=read('app/error-cumulative.json');
 assert.deepEqual([w.period,w.total],['22.10.2026–28.10.2026',86839]);
 assert.deepEqual([c.period,c.total],['01.01.2026–28.10.2026',14216686]);
 assert.equal(read('app/error-organizations.json').totalErrors,w.total);
 assert.equal(c.organizationBreakdown.totalErrors,c.total);
 assert.ok(evidence.qualityWarnings.some(x=>x.metric==='remdErrorsCumulative'));
});
test('full-month ratings and absent waybill source are byte-preserved',()=>{
 for(const [path,expected]of Object.entries(evidence.preservedFiles))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),expected,path);
 assert.equal(read('app/physician-metrics.json').datasets.doctorsAll.period,'сентябрь 2026');
});
