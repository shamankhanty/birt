import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => JSON.parse(fs.readFileSync(path,'utf8'));
const audit=read('docs/update-20261105-source-audit.json');
const mo=read('app/mo-data.json');
const operational=read('app/operational-mo.json');
const preventive=read('app/preventive-semd-audit.json');
const monthly=read('app/monthly-mo.json');
const validation=read('validation/validation-report.json');
const oid='1.2.643.5.1.13.13.12.2.16.1094';

test('November intake prepares 34 indicators and retains invalid or missing sources explicitly',()=>{
 assert.equal(audit.sourceFiles.length,22);
 assert.equal(audit.staging.statistics.preparedIndicators,34);
 assert.deepEqual(audit.staging.retained.map(x=>x.metric).sort(),['ambulatoryCase','electronicWaybill']);
 assert.match(audit.staging.retained.find(x=>x.metric==='ambulatoryCase').reason[0],/пустой числитель у 19 строк при 148907 случаях/u);
 assert.equal(mo.ambulatoryCase.date,'07.11.2026');
 assert.equal(audit.sourceFiles.find(x=>x.family==='ambulatory_cases').status,'PASS');
 assert.equal(audit.sourceFiles.find(x=>x.family==='ambulatory_cases').endDate,'2026-11-03');
 assert.deepEqual(audit.followupValidation.repeatStageChangedFiles,[]);
 assert.ok(audit.sourceFiles.every(x=>/^[a-f0-9]{64}$/u.test(x.sha256)));
});

test('hospital legal entity and Spassk preventive branch use their own source components',()=>{
 const rkb=mo.hospital.rows.find(x=>x.oid===oid);
 const spassk=mo.semd228.rows.find(x=>x.oid===oid);
 const source=preventive.rows.find(x=>x.oid===oid);
 assert.equal(rkb.name,'ГАУЗ "РКБ МЗ РТ"');
 assert.equal(rkb.count,2335);
 assert.equal(read('app/mo-detail-oids.json').hospital[oid].volume,3673);
 assert.equal(rkb.fact,2335/3673*100);
 assert.equal(spassk.name,'Спасская ЦРБ');
 assert.equal(spassk.reportingEntityId,'context:spassk-crb');
 assert.equal(source.selected,Math.max(source.semd122,source.semd228));
 assert.deepEqual([source.selected,source.foms],[7342,8442]);
 assert.equal(spassk.fact,6635/8398*100);
 assert.equal(operational.hospitalCount.rows.find(x=>x.oid===oid).fact,3673);
 assert.equal(mo.hospital.rows.filter(x=>x.sourceStatus==='no_source_row').length,0);
 assert.ok(mo.hospital.rows.filter(x=>x.sourceStatus==='no_source_row').every(x=>x.fact===null));
});

test('partial November does not replace closed months and source anomalies remain under review',()=>{
 assert.equal(monthly.hospital.currentLabel,'На 30.09');
 assert.equal(monthly.doctorsAll.currentLabel,'Октябрь 2026');
 assert.equal(read('app/rating/september-v2-inputs.json').month,'2026-09');
 assert.equal(validation.summary.FAIL,0);
 assert.equal(validation.aiReviewItems.length,6);
 assert.equal(audit.unacceptedAnomalies.length,6);
 assert.ok(validation.aiReviewItems.every(x=>x.reviewReason==='anomaly'));
});
