import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const targets = read('config/max-targets-2026.json');
const views = read('app/max-appointment-plan.json');
const evidence = read('docs/max-appointment-plan-20261103.json');
const page = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
test('approved appointment plans keep 85 identities and all facts missing', () => {
  assert.deepEqual(targets.republic.visit, {'2026-09':514000,'2026-10':561000,'2026-11':608000,'2026-12':654000});
  assert.equal(Object.keys(targets.organizationPlans).length,85);
  for (const [month, total] of Object.entries(evidence.organizationPlanSums)) {
    assert.equal(Object.values(targets.organizationPlans).reduce((sum, mo) => sum + mo.visit[month], 0), total);
  }
  assert.deepEqual(targets.organizationPlans['1.2.643.5.1.13.13.12.2.16.1153'].visit, {'2026-09':4814,'2026-10':5254,'2026-11':5694,'2026-12':6125});
  for (const month of targets.months) assert.ok(Object.values(targets.organizationPlans).every(row => Number.isInteger(row.visit[month]) && row.visit[month]>0));
  for (const [slice,month,previous,plan] of [
    [views.cumulative,'2026-10',null,561000],
    [views.october,'2026-10','2026-09',47000],
    [views.november,'2026-11','2026-10',47000],
  ]) {
    const metric=slice;
    assert.equal(metric.republicPlan,plan);
    assert.equal(metric.plannedMoFact,null);
    assert.equal(metric.sourceTotal,null);
    assert.equal(metric.rows.length,85);
    for(const row of metric.rows) {
      const target=targets.organizationPlans[row.oid];
      assert.ok(target);
      assert.equal(row.plan,target.visit[month]-(previous ? target.visit[previous] : 0));
      assert.equal(row.fact,null);
      assert.equal(row.previous,null);
    }
  }
  assert.match(page,/matrixMetric === "visitMax" \|\| matrixMetric === "tmkMaxCount"/u);
  assert.match(page,/фактическая выгрузка записей по МО пока отсутствует/u);
});
