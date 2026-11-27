import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(`app/${name}.json`, 'utf8'));

test('ASU SMP registrations reconcile by MO and exclude pending and rejected cards', () => {
  const statuses = read('smp-statuses');
  const current = read('mo-data').smp;
  assert.equal(statuses.rows.length, 43);
  for (const key of Object.keys(statuses.total)) {
    assert.equal(statuses.rows.reduce((sum, row) => sum + row[key], 0), statuses.total[key]);
  }
  assert.equal(Object.entries(statuses.total).filter(([key]) => key !== 'cards').reduce((sum, [, value]) => sum + value, 0), statuses.total.cards);
  assert.equal(current.numerator, statuses.total.registered);
  assert.equal(current.denominator, statuses.total.cards);
});

test('TVSP composition changes are distinct from current plan and retain OID evidence', () => {
  const changes = read('tvsp-composition-changes');
  const current = read('unit-data');
  for (const [metric, record] of Object.entries(changes)) {
    assert.ok(record.previousDate && record.currentDate);
    for (const row of record.organizations) {
      assert.match(row.oid, /^1\.2\.643\./);
      assert.ok(row.status);
      if (current[metric].date !== record.currentDate) continue;
      const currentObjects = current[metric].rows.filter((unit) => unit.moOid === row.oid);
      assert.equal(row.currentBuildings, currentObjects.length || null);
      assert.equal(row.currentRegistered, currentObjects.length ? currentObjects.filter((unit) => unit.registered).length : null);
    }
  }
});

test('Zelenodolsk FAP discrepancy remains explicit and is not classified as an MO violation', () => {
  const fap = read('operational-mo').fapSemdCount;
  const row = fap.rows.find((item) => item.name.includes('Зеленодольская ЦРБ'));
  assert.equal(row.previous, 100164);
  assert.equal(row.fact, 100603);
  assert.equal(row.units, 41);
  assert.equal(row.zeroUnits, 0);
  assert.equal(row.sourceWarning, undefined);
});
