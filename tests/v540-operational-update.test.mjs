import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const op = JSON.parse(fs.readFileSync(new URL('../app/operational-mo.json', import.meta.url), 'utf8'));
const errors = JSON.parse(fs.readFileSync(new URL('../app/error-categories.json', import.meta.url), 'utf8'));
const mo = JSON.parse(fs.readFileSync(new URL('../app/mo-data.json', import.meta.url), 'utf8'));

test('v5.4.0 header separates operational cut from full-month rating', () => {
  assert.ok(page.includes('Версия {DASHBOARD_VERSION} · оперативные данные 11–13.09.2026 · рейтинг: август 2026'));
  assert.ok(!page.includes('данные на 30.08.2026'));
});

test('MAX comparison periods follow real source cuts', () => {
  for (const id of ['tmkMaxCount','elnMaxCount']) {
    assert.equal(op[id].previousDate, '07.09.2026');
    assert.equal(op[id].previousPeriod, '01.01–07.09.2026');
    assert.equal(op[id].date, '11.09.2026');
    assert.equal(op[id].period, '01.01–11.09.2026');
  }
  assert.ok(page.includes('selectedDataset.previousPeriod ?? selectedDataset.previousDate'));
});

test('REMD errors use operational weekly cut', () => {
  assert.equal(errors.period, '07.09.2026–13.09.2026');
  assert.equal(errors.total, 2046140);
  assert.ok(page.includes('name: "Количество ошибок регистрации СЭМД за последнюю полную неделю"'));
  assert.ok(page.includes('fact: 2046140'));
});

test('operational 500+ is reference-only in hearings and does not replace monthly rating', () => {
  assert.ok(page.includes('id: `operational500_${id}`'));
  assert.ok(page.includes('affectsPriority: false'));
  assert.ok(page.includes('В месячный рейтинг не включается'));
});

test('hearing aggregate is labeled as an index while individual contribution stays in pp', () => {
  assert.ok(page.includes('суммарного индекса влияния на цели РТ'));
  assert.ok(page.includes('Текущий индекс влияния'));
  assert.ok(page.includes('вклад в недостижение РТ'));
});

test('EPGU current cut is 11 September with previous comparable source cut', () => {
  for (const id of ['egpu','egpu2days']) {
    assert.equal(mo[id].date, '11.09.2026');
    assert.equal(mo[id].previousDate, '07.09.2026');
  }
});

test('user version history is aggregated instead of exposing technical patch churn', () => {
  assert.ok(page.includes('Неделя 07–13.09.2026'));
  assert.ok(page.includes('Неделя 31.08–06.09.2026'));
  assert.ok(page.includes('Неделя 24–30.08.2026'));
});
