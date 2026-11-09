import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolveReportingPeriods} from '../lib/period-engine.js';

const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const app = n => read(`app/${n}.json`);
const previous = n => read(`baseline/archive/before-20261102/app/${n}.json`);

test('accepted October values have an independent primary-source audit and exact file hashes',()=>{
 const audit=read('docs/update-20261102-independent-audit.json');
 assert.equal(audit.status,'PASS');
 assert.equal(audit.sourceCount,22);
 assert.equal(audit.checks.length,50);
 assert.ok(audit.checks.every(c=>c.status==='PASS'));
 const preventive=read('docs/preventive-20261104.json');
 assert.equal(preventive.summary.numerator,2201997);
 assert.equal(preventive.summary.denominator,2419529);
 assert.deepEqual(Object.keys(preventive.acceptedAppSha256).sort(),['app/mo-data.json','app/mo-detail-oids.json','app/mo-details.json','app/preventive-semd-audit.json']);
 // The preventive audit records the rating UI as unchanged on 04.11, but later visual edits
 // may change that component without changing the accepted September inputs or October data.
 const {['app/september-rating.tsx']: historicalRatingUiHash, ...unchangedDataFiles}=preventive.unchangedFileSha256;
 assert.equal(historicalRatingUiHash,'b0e5adfa26687c21dd56dadabcde62c6cbda4471d2491ff85f4580900efacbc0');
 const correction=read('docs/hospital-source-attribution-20261105.json');
 const currentAudit=read('docs/update-20261105-source-audit.json');
 assert.equal(correction.moDataPreviousSha256,preventive.acceptedAppSha256['app/mo-data.json']);
 assert.equal(currentAudit.beforeSha256['app/mo-data.json'],correction.moDataCorrectedSha256);
 const currentHashes=read('baseline/current-production-manifest.json').files;
 // The November 09 promotion explicitly replaces these October MAX snapshots.
 // Historic evidence hashes stay fixed; promoted hashes are verified against the production manifest.
 const refreshedPaths=new Set(['app/mo-data.json','app/mo-detail-oids.json','app/mo-details.json','app/operational-mo.json','app/organization-status.json','app/unit-data.json','app/unit-mo-snapshots.json','app/max-period-views.json','app/monthly-mo.json','app/month-closure-2026-10.json']);
 const frmrPaths=new Set(['app/frmr-all-specialties.json','app/frmr-previous-control.json','app/frmr-sp-types.json']);
 for(const [path,hash] of Object.entries({...audit.acceptedAppSha256,...preventive.acceptedAppSha256,...unchangedDataFiles})) {
  if(frmrPaths.has(path)) continue;
  if(path in currentAudit.afterSha256) continue;
  const archivedPath=path==='app/semd-summary.json' ? `baseline/archive/accepted-20261102/${path}` : path;
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archivedPath)).digest('hex'),refreshedPaths.has(path)?currentHashes[path]:hash,path);
 }
 for(const [path,hash] of Object.entries(currentAudit.afterSha256))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),refreshedPaths.has(path)?currentHashes[path]:hash,path);
});

test('09 November MAX promotion keeps historic audit immutable and reconciles new October figures',()=>{
 const source=read('docs/update-20261109-max-components.json');
 const views=app('max-period-views');
 const monthly=app('monthly-mo');
 const closure=app('month-closure-2026-10').maxOctober;
 assert.equal(source.rows.split(';').length,97);
 assert.deepEqual(source.totals.octoberMonthly,[16224,12590]);
 const metrics=[['tmkMaxCount','tmk',16224],['elnMaxCount','eln',12590]];
 for(const [id,key,expected] of metrics){
  assert.equal(monthly[id].rows.reduce((sum,r)=>sum+(r.july??0),0),expected);
  assert.equal(views.closedMonths['2026-10'].operational.metrics[key].sourceTotal,expected);
  assert.equal(closure[key],expected);
 }
 assert.equal(closure.cumulativeTmk,74208);
 assert.equal(closure.cumulativeEln,55268);
 const manifest=read('baseline/current-production-manifest.json');
 for(const file of ['app/max-period-views.json','app/monthly-mo.json','app/month-closure-2026-10.json']){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),manifest.files[file]);
 }
});

test('partial November physician slice retains the closed October comparison',()=>{
 const current=app('physician-weekly-snapshot'), old=previous('physician-weekly-snapshot'), monthly=app('physician-metrics');
 assert.equal(current.period,'01.11.2026–04.11.2026');
 assert.equal(current.previousSummary.doctorsAll.numerator,monthly.datasets.doctorsAll.summary.numerator);
 for(const [id,ds] of Object.entries(monthly.datasets)) {
   const rows=current.previousDatasets[id];
  for(const r of ds.rows) {
   const same=rows.find(x=>x.oid===r.oid);
   assert.ok(same);
   assert.equal(same.count,r.count,`${id}/${r.oid}`);
  }
 }
 assert.equal(current.summary.doctorsAll.numerator,7694);
 assert.equal(current.previousSummary.doctorsAll.numerator,11220);
});

test('the first ambulance organization is present and the grand total reconciles',()=>{
 const d=app('mo-data').smp;
 assert.equal(d.rows.length,43);
 assert.equal(d.numerator,768923);
 assert.equal(d.denominator,814120);
 const agriz=d.rows.find(r=>r.name.includes('Агрызская'));
 assert.ok(agriz.count>0&&agriz.volume>=agriz.count);
 assert.equal(d.rows.reduce((s,r)=>s+r.count,0),d.numerator);
 assert.equal(d.rows.reduce((s,r)=>s+r.volume,0),d.denominator);
});

test('standalone October MAX never borrows a cumulative September baseline',()=>{
 for(const [id,total] of [['tmkMaxCount',16224],['elnMaxCount',12590]]){
  const ds=app('monthly-mo')[id];
  assert.equal(ds.periodType,'month');
  assert.equal(ds.currentLabel,'Октябрь 2026');
  assert.equal(ds.rows.reduce((s,r)=>s+(r.july??0),0),total);
  assert.ok(ds.rows.every(r=>r.june===null&&r.change===null));
 }
});

test('January-October reports cannot replace standalone September EPGU or the approved rating',()=>{
 for(const id of ['egpu','egpu2days','birth','hospital']){
  const current=app('monthly-mo')[id], old=previous('monthly-mo')[id];
  assert.deepEqual(current.rows,old.rows);
  assert.equal(current.currentLabel,old.currentLabel);
  assert.equal(current.ratingState,'retained_incomplete_period');
 }
 const rating=read('app/rating/september-v2-inputs.json');
 assert.equal(rating.month,'2026-09');
 assert.equal(app('month-closure-2026-10').ratingStatus,'deferred');
 const periods=resolveReportingPeriods({physicianMetrics:app('physician-metrics'),datasets:Object.values(app('mo-data'))});
 assert.equal(periods.latestFullMonth.label,'октябрь 2026');
 const page=fs.readFileSync('app/page.tsx','utf8');
 assert.match(page,/ratingPeriod: "октябрь 2026"/);
 assert.match(page,/ratingRows = useMemo\(\(\) => septemberRatingArchive.rows/);
});

test('report period recognition uses an explicit October header, even when exported in November',()=>{
 const result=spawnSync('python3',['-c',`
import sys,tempfile
from pathlib import Path
from datetime import datetime
from openpyxl import Workbook
sys.path.insert(0,'scripts')
from pipeline.excel_structure import inspect_workbook
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'arbitrary-name.xlsx'
 w=Workbook();s=w.active;s.title='Все врачи_Детализация по МО';w.create_sheet('Врачи по спец-тям_По МО')
 s.append(['Период формирования отчета:','Год:',2026,'Период:','Октябрь'])
 s.append(['Дата формирования отчета:',datetime(2026,11,2)])
 w.save(p)
 r=inspect_workbook(p);assert (r['startDate'],r['endDate'])==('2026-10-01','2026-10-31'),r
 s.cell(2,2,datetime(2026,10,29));w.save(p)
 r=inspect_workbook(p);assert r['endDate']=='2026-10-28',r
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
});

