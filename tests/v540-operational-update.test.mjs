import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const op = JSON.parse(fs.readFileSync(new URL('../app/operational-mo.json', import.meta.url), 'utf8'));
const errors = JSON.parse(fs.readFileSync(new URL('../app/error-categories.json', import.meta.url), 'utf8'));
const mo = JSON.parse(fs.readFileSync(new URL('../app/mo-data.json', import.meta.url), 'utf8'));

test('v5.4.0 header separates operational cut from full-month rating', () => {
  assert.ok(page.includes('DASHBOARD_VERSION'));
  assert.ok(!page.includes('данные на 30.08.2026'));
});

test('MAX compares the current export with the previous export without calling it a week', () => {
  for (const id of ['tmkMaxCount','elnMaxCount']) {
    assert.match(op[id].date, /^\d{2}\.\d{2}\.2026$/u);
    assert.match(op[id].period, /^01\.01–\d{2}\.\d{2}\.2026$/u);
    assert.match(op[id].previousDate, /^\d{2}\.\d{2}\.2026$/u);
    assert.match(op[id].previousPeriod, /^01\.01[–-]\d{2}\.\d{2}\.2026$/u);
  }
  assert.ok(page.includes('Оперативно — текущая выгрузка к предыдущей'));
  assert.ok(page.includes('Предыдущая выгрузка'));
  assert.ok(page.includes('Текущая выгрузка'));
  assert.ok(page.includes('Интервал и сопоставимость'));
  assert.ok(!page.includes('Нет двух полных сопоставимых недель'));
});

test('REMD errors use the latest approved operational cut', () => {
  assert.match(errors.period, /^(?:\d{2}\.\d{2}\.2026–)?\d{2}\.\d{2}\.2026$/u);
  assert.ok(errors.total >= 0);
  assert.ok(page.includes('name: "Количество ошибок регистрации СЭМД за последнюю полную неделю"'));
  assert.ok(page.includes('errorCategories.total'));
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

test('EPGU current cut has a previous comparable source cut', () => {
  for (const id of ['egpu','egpu2days']) {
    assert.match(mo[id].date, /^\d{2}\.\d{2}\.2026$/u);
    assert.match(mo[id].previousDate, /^\d{2}\.\d{2}\.2026$/u);
  }
});

test('user version history is aggregated instead of exposing technical patch churn', () => {
  assert.ok(page.includes('Неделя 07–13.09.2026'));
  assert.ok(page.includes('Неделя 31.08–06.09.2026'));
  assert.ok(page.includes('Неделя 24–30.08.2026'));
});
