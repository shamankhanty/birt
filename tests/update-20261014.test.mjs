import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {aggregateQuantityPairs} from '../lib/calculation-engine.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
test('month name does not advance a partial physician export to month end',()=>{
 const code=`import sys,tempfile,types
from pathlib import Path
sys.path.insert(0,'scripts/pipeline')
import source_catalog as c
with tempfile.TemporaryDirectory() as td:
 p=Path(td)/'Отчёт_по_врачам_сформировавших_СЭМД - Октябрь.xlsx'
 p.write_bytes(b'fixture')
 c.integrity=lambda p:'PASS'
 sys.modules['excel_structure']=types.SimpleNamespace(inspect_workbook=lambda p:{'family':'physicians','startDate':'2026-10-01','endDate':'2026-10-13'})
 item=c.classify(p)
 assert item.endDate=='2026-10-13',item
 assert item.startDate=='2026-10-01',item
`;
 const r=spawnSync(process.platform==='win32'?'python':'python3',['-c',code],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
test('REMD source total and registered types reconcile without mixing periods',()=>{
 const s=read('app/semd-summary.json');
 assert.equal(s.total,82198158);assert.equal(s.registeredTypes,97);
 assert.equal(s.period,'01.01.2026–25.10.2026');assert.equal(s.formed,'26.10.2026 07:22');
 assert.equal(s.items.reduce((n,r)=>n+r.count,0),s.total);
 assert.equal(s.items.filter(r=>r.count>0).length,s.registeredTypes);
 const month=read('app/physician-metrics.json');const op=read('app/physician-weekly-snapshot.json');
 assert.equal(month.period,'сентябрь 2026');assert.equal(op.date,'24.10.2026');
 assert.equal(month.datasets.doctorsAll.summary.numerator,10674);assert.equal(op.summary.doctorsAll.numerator,10875);
});
test('approved statuses and current methodology audit are wired into the page',()=>{
 const page=fs.readFileSync('app/page.tsx','utf8');
 assert.match(page,/regionalStatus = row\.regionalManualStatus === "achieved"/u);
 assert.doesNotMatch(page,/setDynamicsMode\(id\.startsWith\("doctor"\) \? "month"/u);
 assert.match(page,/const chooseDetailMetric =[\s\S]*?setMatrixMetric\(key\)[\s\S]*?setDynamicsMode\("operational"\)/u);
 assert.match(page,/const calcErrors: typeof historicalCalcErrors = methodologyAudit\.items/u);
 const audit=read('app/methodology-audit.json');assert.equal(audit.checkedAt,'14.10.2026');
 assert.ok(audit.items.some(r=>r.source.includes('Профилактика')&&r.issue.includes('сопоставимая пара')&&r.status==='Исправлена'));
 assert.ok(audit.items.some(r=>r.source.includes('МБТ 37')&&r.status==='Исправлена'));
});
test('physician month comparison uses full-month components rather than October facts',()=>{
 const rows=read('app/monthly-mo.json').doctor500_pediatrician.rows;
 const previous=aggregateQuantityPairs(rows,'juneQuantity');
 const current=aggregateQuantityPairs(rows,'julyQuantity');
 assert.deepEqual([previous.numerator,previous.denominator],[797,1353]);
 assert.deepEqual([current.numerator,current.denominator],[833,1357]);
 const page=fs.readFileSync('app/page.tsx','utf8');
 assert.match(page,/june: physicianPreviousMonth\.fact/u);
 assert.match(page,/july: physicianCurrentMonth\.fact/u);
 assert.match(page,/monthlyDataset\?\.previousLabel/u);
 assert.match(page,/monthlyDataset\?\.currentLabel/u);
});
