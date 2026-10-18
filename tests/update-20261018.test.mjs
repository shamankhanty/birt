import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('update 18.10.2026 imports comparable reports and retains mismatched prevention pair', async () => {
  const [mo, units, weekly, audit, evidence] = await Promise.all([
    readJson('app/mo-data.json'), readJson('app/unit-data.json'),
    readJson('app/physician-weekly-snapshot.json'), readJson('app/methodology-audit.json'),
    readJson('docs/update-20261018-evidence.json'),
  ]);
  assert.equal(mo.hospital.date, '17.10.2026');
  assert.deepEqual([mo.hospital.numerator, mo.hospital.denominator], [677367, 761865]);
  assert.deepEqual([mo.tvspAmbulatory.numerator, mo.tvspAmbulatory.denominator], [795, 896]);
  assert.deepEqual([mo.tvspStationary.numerator, mo.tvspStationary.denominator], [686, 844]);
  assert.deepEqual([units.tvspAmbulatory.plan, units.tvspAmbulatory.fact], [458, 458]);
  assert.deepEqual([units.tvspStationary.plan, units.tvspStationary.fact], [273, 270]);
  assert.equal(weekly.date, '17.10.2026');
  assert.equal(weekly.previousDate, '13.10.2026');
  assert.deepEqual([weekly.summary.doctorsAll.numerator, weekly.summary.doctorsAll.denominator], [10241, 13626]);
  assert.equal(mo.semd228.date, '13.10.2026');
  assert.equal(evidence.status, 'WARNING');
  assert.ok(audit.items.some((item) => item.source === 'Профилактика — СЭМД 122/228 и обращения ФОМС' && item.status === 'Требует уточнения'));
});
