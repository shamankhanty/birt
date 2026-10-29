import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFederalDetailCatalog, federalMetricTarget } from '../lib/federal-navigation.js';
const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
const control = read('app/federal-control.json');
const ids = Object.keys({ ...read('app/mo-data.json'), ...read('app/operational-mo.json'),
  ...read('app/organization-status.json'), ...read('app/physician-metrics.json').datasets });

test('every noncomponent federal card resolves to an existing indicator or its own detail page', () => {
  const catalog = buildFederalDetailCatalog(control, ids);
  const targets = new Set([...ids, ...catalog.map(x => x.key)]);
  let count = 0;
  for (const source of ['agreement', 'collegium']) for (const row of control[source]) {
    if (row.type === 'Компонент') continue;
    assert.ok(targets.has(federalMetricTarget(row, source, ids)), `${source}:${row.id}`);
    count++;
  }
  assert.equal(count, 69);
  assert.equal(catalog.length, 43);
  assert.equal(catalog.filter(x => x.row.regionalFact).length, 28);
  assert.equal(catalog.filter(x => !x.row.regionalFact).length, 15);
});

test('source numbering collisions stay separate and invalid regional ids fall back safely', () => {
  const data = {agreement: [{id:'1', type:'Показатель', regionalId:'missing'}], collegium: [{id:'1',type:'Показатель'}]};
  const catalog = buildFederalDetailCatalog(data, ['egpu']);
  assert.deepEqual(catalog.map(x => x.key), ['federal:agreement:1', 'federal:collegium:1']);
  assert.equal(federalMetricTarget(data.agreement[0], 'agreement', ['egpu']), catalog[0].key);
  assert.equal(federalMetricTarget({id:'17',regionalId:'egpu'}, 'agreement', ['egpu']), 'egpu');
});

test('detail catalog preserves reported facts without creating organization rows', () => {
  const detail = buildFederalDetailCatalog(control, ids).find(x => x.key === 'federal:agreement:34');
  assert.equal(detail.row.regionalFact, '98%');
  assert.equal(detail.row.regionalPeriod, 'январь–сентябрь 2026');
  assert.equal('rows' in detail, false);
  assert.equal('rows' in detail.row, false);
});
