import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
const count = read('app/operational-mo.json').hospitalCount;
const ratio = read('app/mo-data.json').hospital;

test('hospital count reconciles with case denominator from the same October source', () => {
  assert.equal(count.date, ratio.date);
  assert.equal(count.date, '25.10.2026');
  assert.equal(count.total, 782059);
  assert.equal(count.rows.reduce((sum, row) => sum + (row.fact ?? 0), 0), ratio.denominator);
  assert.equal(count.rows.reduce((sum, row) => sum + row.sourceRows, 0), 130);
  assert.equal(new Set(count.rows.map(row => row.oid)).size, count.rows.length);
  assert.equal(count.rows.length, 129);
  assert.equal(count.rows.find(row => row.oid === '1.2.643.5.1.13.13.12.2.16.1088').fact, 5205);
  assert.equal(count.rows.find(row => row.oid === '1.2.643.5.1.13.13.12.2.16.15115').fact, 660);
  assert.equal(ratio.numerator, 709565);
  assert.equal(count.plan, null);
});


test('source total and management perimeter differ only by the approved KGMA exclusion', () => {
  const runtime = read('baseline/calculation-runtime-snapshot.json').allIndicators.hospitalCount;
  assert.equal(runtime.fact, 781683);
  assert.equal(count.total - runtime.fact, 376);
  const excluded = count.rows.filter(row => /КГМА.*РМАНПО/u.test(row.name));
  assert.equal(excluded.reduce((sum, row) => sum + row.fact, 0), 376);
});
