import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=process.cwd();
const py=(code,args=[])=>spawnSync('python3',['-c',code,...args],{cwd:root,encoding:'utf8'});
const classify=(name)=>{
  const code=`import sys,json;from pathlib import Path;sys.path.insert(0,'scripts/pipeline');from source_catalog import classify;i=classify(Path(sys.argv[1]));print(json.dumps(i.__dict__,ensure_ascii=False))`;
  const r=py(code,[name]); assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout);
};
const makeXlsx=(file)=>{const code=`from openpyxl import Workbook;import sys;w=Workbook();w.save(sys.argv[1])`;const r=py(code,[file]);assert.equal(r.status,0,r.stderr)};

test('pipeline catalog recognizes representative historical source families',()=>{
 const cases={
  'ПР_2_01.01-31.08.2026.xlsx':'egpu_attachment',
  'Отчет_по_госпитализациям__-_01.01.2026-31.08.2026.xlsx':'hospital_cases',
  '1.Отчет СЭМД_РЭМД январь - август.xlsx':'preventive_remd',
  'Количество_СЭМД_Результаты_профилактического_медицинского_осмотрадиспансеризации Январь - Август.xlsx':'preventive_foms',
  'Свидетельства_о_рождении 31.08.2026.xlsx':'birth_certificates',
  'I_Свид-ва о смерти 31.08.2026.xlsx':'death_certificates',
  'ТМК_МАХ 31.08.2026.xlsx':'max_tmk_eln',
  'Отчёт_по_врачам август 2026.xlsx':'physicians',
  'Отчет_Доля_ТВСП_СЭМД_Протокол лабораторного 31.08.2026.xlsx':'tvsp_laboratory',
  'Отчет_СМП_ТВСП 31.08.2026.xlsx':'smp_tvsp',
  'Отчёт - Отказы 31.08.2026.xlsx':'remd_errors',
  'Отчёт_по_использованию_системы_31.08.2026.xlsx':'electronic_waybill'
 };
 for(const [name,fam] of Object.entries(cases)){const x=classify(name);assert.equal(x.status,'PASS',name);assert.equal(x.family,fam,name)}
});

test('unknown file is WARNING, not silent PASS',()=>{assert.equal(classify('Совершенно_новый_отчет_07.09.2026.xlsx').status,'WARNING')});

test('damaged Excel is FAIL even when filename is recognized',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'rt-pipe-'));const f=path.join(d,'ПР_2_07.09.2026.xlsx');fs.writeFileSync(f,'not-an-xlsx');const x=classify(f);assert.equal(x.integrity,'FAIL');assert.equal(x.status,'FAIL')});

test('duplicate same family and period becomes FAIL',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'rt-pipe-')); makeXlsx(path.join(d,'ПР_2_a_31.08.2026.xlsx')); makeXlsx(path.join(d,'ПР_2_b_31.08.2026.xlsx'));
 const code=`import sys,json;from pathlib import Path;sys.path.insert(0,'scripts/pipeline');from source_catalog import scan;print(json.dumps(scan(Path(sys.argv[1])),ensure_ascii=False))`;
 const r=py(code,[d]); assert.equal(r.status,0,r.stderr); const x=JSON.parse(r.stdout); assert.equal(x.summary.FAIL,2); assert.equal(x.duplicates.length,1);
});

test('partial September does not replace August full-month baseline',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'rt-pipe-')); makeXlsx(path.join(d,'ПР_2_07.09.2026.xlsx'));
 const code=`import sys,json;from pathlib import Path;sys.path.insert(0,'scripts/pipeline');from source_catalog import scan;print(json.dumps(scan(Path(sys.argv[1])),ensure_ascii=False))`;
 const r=py(code,[d]); const x=JSON.parse(r.stdout); assert.equal(x.summary.effectiveLatestFullMonthEnd,'2026-08-31'); assert.equal(x.summary.previousComparableMonthEnd,'2026-07-31'); assert.equal(x.summary.hasPartialNewerMonth,true);
});

test('closed September automatically advances full month',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'rt-pipe-')); makeXlsx(path.join(d,'ПР_2_30.09.2026.xlsx'));
 const code=`import sys,json;from pathlib import Path;sys.path.insert(0,'scripts/pipeline');from source_catalog import scan;print(json.dumps(scan(Path(sys.argv[1])),ensure_ascii=False))`;
 const r=py(code,[d]); const x=JSON.parse(r.stdout); assert.equal(x.summary.effectiveLatestFullMonthEnd,'2026-09-30'); assert.equal(x.summary.previousComparableMonthEnd,'2026-08-31');
});

test('shadow pipeline leaves protected files unchanged and blocks apply',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'rt-pipe-')); makeXlsx(path.join(d,'ПР_2_07.09.2026.xlsx'));
 const report=path.join(d,'report.json'); const r=spawnSync('python3',['scripts/weekly_update_pipeline.py',d,'--report',report,'--skip-refactor-gate'],{cwd:root,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); const x=JSON.parse(fs.readFileSync(report,'utf8')); assert.deepEqual(x.protectedChanged,[]); assert.equal(x.decision,'PASS');
 const r2=spawnSync('python3',['scripts/weekly_update_pipeline.py',d,'--report',report,'--skip-refactor-gate','--apply'],{cwd:root,encoding:'utf8'}); assert.equal(r2.status,2); const y=JSON.parse(fs.readFileSync(report,'utf8')); assert.equal(y.applyBlocked,true); assert.equal(y.decision,'FAIL');
});

test('legacy dated update scripts remain available as reference adapters',()=>{
 const legacy=fs.readdirSync(path.join(root,'scripts')).filter(x=>/^update[-_].*\.(py)$/.test(x)); assert.ok(legacy.length>=10); assert.ok(legacy.includes('update_july_august_2026.py'));
});

test('stage9 supports every catalogued source family in staging',()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/import-pipeline.json'),'utf8'));
 const all=cfg.families.map(x=>x.id).sort(); const supported=[...cfg.stage9.supportedFamilies].sort();
 assert.deepEqual(supported,all); assert.equal(all.length,20);
});
