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
 for(const [path,hash] of Object.entries({...audit.acceptedAppSha256,...preventive.acceptedAppSha256,...preventive.unchangedFileSha256}))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),hash,path);
});

test('October physician values replace values, not only dates; prior operational cut is preserved',()=>{
 const current=app('physician-weekly-snapshot'), old=previous('physician-weekly-snapshot'), monthly=app('physician-metrics');
 assert.deepEqual(current.previousDatasets,old.datasets);
 assert.deepEqual(current.previousSummary,old.summary);
 assert.deepEqual(current.previousPeriods,old.periods);
 for(const [id,ds] of Object.entries(monthly.datasets)) {
  const rows=current.datasets[id];
  for(const r of ds.rows) {
   const same=rows.find(x=>x.oid===r.oid);
   assert.ok(same);
   assert.deepEqual([same.count,same.volume??null,same.fact],[r.count,r.volume??null,r.fact],`${id}/${r.oid}`);
  }
 }
 assert.equal(current.summary.doctorsAll.numerator,11220);
 assert.equal(current.previousSummary.doctorsAll.numerator,11031);
});

test('the first ambulance organization is present and the grand total reconciles',()=>{
 const d=app('mo-data').smp;
 assert.equal(d.rows.length,43);
 assert.equal(d.numerator,751012);
 assert.equal(d.denominator,792234);
 const agriz=d.rows.find(r=>r.name.includes('Агрызская'));
 assert.deepEqual([agriz.count,agriz.volume],[6503,6687]);
 assert.equal(d.rows.reduce((s,r)=>s+r.count,0),d.numerator);
 assert.equal(d.rows.reduce((s,r)=>s+r.volume,0),d.denominator);
});

test('standalone October MAX never borrows a cumulative September baseline',()=>{
 for(const [id,total] of [['tmkMaxCount',15573],['elnMaxCount',12498]]){
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
 assert.match(page,/ratingPeriod: ratingMonth.label/);
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
