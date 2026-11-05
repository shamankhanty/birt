import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
const count = read('app/operational-mo.json').hospitalCount;
const ratio = read('app/mo-data.json').hospital;

test('hospital count reconciles with case denominator from the 04 November source', () => {
  assert.equal(count.date, ratio.date);
  assert.equal(count.date, '04.11.2026');
  assert.equal(count.total, 805961);
  assert.equal(count.rows.reduce((sum, row) => sum + (row.fact ?? 0), 0), ratio.denominator);
  assert.equal(count.rows.reduce((sum, row) => sum + (row.sourceRows ?? 0), 0), 107);
  assert.equal(new Set(count.rows.map(row => row.oid)).size, count.rows.length);
  assert.equal(count.rows.length, 129);
  assert.equal(count.rows.find(row => row.oid === '1.2.643.5.1.13.13.12.2.16.1094').fact, 3644);
  assert.equal(ratio.numerator, 747202);
  assert.ok(count.rows.some(row => row.sourceStatus === 'no_source_row' && row.fact === null));
  assert.equal(count.plan, null);
});


test('source total and management perimeter reconcile after absent KGMA source row is marked missing', () => {
  const runtime = read('baseline/calculation-runtime-snapshot.json').allIndicators.hospitalCount;
  assert.equal(runtime.fact, 805961);
  assert.equal(count.total - runtime.fact, 0);
  const excluded = count.rows.filter(row => /КГМА.*РМАНПО/u.test(row.name));
  assert.equal(excluded.reduce((sum, row) => sum + (row.fact ?? 0), 0), 0);
});
