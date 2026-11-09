import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoRegistryRuntime } from '../lib/mo-registry.js';

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const audit = read('app/preventive-semd-audit.json');
const dataset = read('app/mo-data.json').semd228;
const runtime = createMoRegistryRuntime(read('app/mo-registry.json'));

test('internal 08 November preventive cut reconciles 86 MO and preserves historical 04 November audit', () => {
  assert.equal(dataset.date,'08.11.2026');
  assert.equal(dataset.previousDate,'04.11.2026');
  assert.equal(dataset.previousNumerator,null);
  assert.equal(dataset.previousDenominator,null);
  assert.equal(dataset.rows.length,86);
  assert.equal(dataset.numerator,2151548);
  assert.equal(dataset.denominator,2366215);
  assert.equal(dataset.fact,2151548/2366215*100);
  const source=read('app/mo-detail-oids.json').semd228;
  assert.equal(Object.values(source).reduce((s,r)=>s+r.registered,0),dataset.numerator);
  assert.equal(Object.values(source).reduce((s,r)=>s+r.volume,0),dataset.denominator);
  assert.equal(audit.rows.length,95);
  assert.equal(audit.summary.numerator,2234491);
  assert.equal(audit.summary.denominator,2439787);
});

test('Spassk receives preventive fact under preserved RKB legal OID; certificates stay RKB', () => {
  const row = dataset.rows.find(r=>r.oid==='1.2.643.5.1.13.13.12.2.16.1094');
  const detail = audit.rows.find(r=>r.oid===row.oid);
  assert.equal(row.name,'Спасская ЦРБ');
  assert.equal(row.reportingEntityId,'context:spassk-crb');
  assert.equal(row.fact,6635/8398*100);
  assert.equal(detail.semd228,6106);
  assert.equal(detail.semd122,7342);
  assert.equal(detail.foms,8442);
  assert.equal(runtime.organizationForMetric('semd228',row).oid,'context:spassk-crb');
  assert.equal(runtime.organizationForMetric('death',{name:'РКБ',oid:row.oid}).oid,row.oid);
  assert.equal(runtime.organizationForMetric('birth',{name:'РКБ',oid:row.oid}).oid,row.oid);
  assert.equal(dataset.rows.filter(r=>r.oid===row.oid).length,1);
});

test('missing external source stays excluded and cumulative export preserves September snapshot', () => {
  assert.equal(audit.excluded.length,1);
  assert.equal(audit.excluded[0].denominator,1);
  assert.ok(!dataset.rows.some(r=>r.oid===audit.excluded[0].oid&&r.count===0));
  const evidence = read('docs/preventive-20261104.json');
  assert.equal(evidence.monthlySnapshotUnchanged,true);
  const monthly=read('app/monthly-mo.json').semd228;
  assert.equal(monthly.currentLabel,'На 30.09');
  assert.equal(monthly.ratingState,'retained_incomplete_period');
});
