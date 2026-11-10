import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../app/contract-semd-monitoring.json', import.meta.url)));
const summary = JSON.parse(readFileSync(new URL('../app/semd-summary.json', import.meta.url)));
const federal = JSON.parse(readFileSync(new URL('../app/federal-control.json', import.meta.url)));

test('contract SEMD registrations reconcile to source and are not mistaken for qualitative fulfilment', () => {
  assert.match(evidence.currentPeriod, /01\.01\.2026 - 07\.11\.2026/);
  assert.match(evidence.previousPeriod, /01\.01\.2026 - 31\.10\.2026/);
  const matched = evidence.items.filter((item) => item.current > 0);
  assert.deepEqual(matched.map((item) => item.agreementId), ['11', '12', '14']);
  for (const item of evidence.items) {
    assert.equal(item.current, summary.items.find((row) => row.name === item.semdName)?.count);
    assert.equal(item.current, item.organizations.reduce((sum, row) => sum + row.current, 0));
    assert.equal(item.previous, item.organizations.reduce((sum, row) => sum + row.previous, 0));
    assert.equal(item.current - item.previous, item.organizations.reduce((sum, row) => sum + row.change, 0));
    assert.equal(federal.agreement.find((row) => row.id === item.agreementId)?.status, 'В контракте');
  }
  assert.deepEqual(matched.find((item) => item.agreementId === '14').organizations
    .filter((row) => row.current > 0).map((row) => [row.oid, row.current]),
    [['1.2.643.5.1.13.13.12.2.16.1208', 1]]);
});
