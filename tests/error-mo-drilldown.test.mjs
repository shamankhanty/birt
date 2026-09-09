import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const pageFlat = page.replace(/\s+/g, ' ');
const adapters = fs.readFileSync(new URL('../scripts/pipeline/adapters.py', import.meta.url), 'utf8');
const current = JSON.parse(fs.readFileSync(new URL('../app/error-categories.json', import.meta.url), 'utf8'));
const organizations = JSON.parse(fs.readFileSync(new URL('../app/error-organizations.json', import.meta.url), 'utf8'));

test('current category baseline matches the approved 07.09 cumulative source', () => {
  assert.equal(current.total, 10489964);
  assert.equal(current.items.length, 34);
  assert.equal(current.period, '01.01–07.09.2026');
});

test('error UI exposes category and MO drilldowns without quality-rating wording', () => {
  for (const text of [
    'По категориям', 'По медицинским организациям',
    'Отнесено к медицинским организациям',
    'Медицинская организация не определена',
    'Полнота привязки', 'СТРУКТУРА ОШИБОК МЕДИЦИНСКОЙ ОРГАНИЗАЦИИ',
    'абсолютное количество ошибок', 'не является «долей ошибок»', 'рейтингом качества',
  ]) assert.ok(pageFlat.includes(text), `missing UI contract: ${text}`);
  assert.ok(page.includes('selectedCategoryOrganizations'));
  assert.ok(page.includes('activeErrorOrganization'));
});

test('REMD errors are a primary section and methodology errors stay separate', () => {
  for (const text of [
    '["remdErrors", "Ошибки РЭМД", "07"]',
    '["errors", "Ошибки методик", "12"]',
    'МО для заслушивания',
  ]) assert.ok(page.includes(text), `missing navigation contract: ${text}`);
});

test('adapter preserves source MO and reports completeness separately from registry coverage', () => {
  for (const token of [
    'organizationBreakdown', 'attributedErrors', 'unassignedErrors', 'coveragePercent',
    'registryMatchedErrors', 'registryCoveragePercent', 'sourceName', 'topCategories',
  ]) assert.ok(adapters.includes(token), `missing adapter field ${token}`);
});

test('hearing cards include reference-only REMD errors without changing priority', () => {
  for (const token of [
    'id: "remd-registration-errors"',
    'name: "Отказы регистрации СЭМД"',
    'affectsPriority: false',
    'status: "reference"',
    'ТОП ошибок',
  ]) assert.ok(page.includes(token), `missing hearing error contract: ${token}`);
  assert.match(pageFlat, /regionalContribution !== null/);
});

test('current source is fully attributable to source organizations', () => {
  const breakdown = organizations;
  assert.ok(breakdown, 'organization breakdown is missing');
  assert.equal(breakdown.totalErrors, current.total);
  assert.equal(breakdown.attributedErrors, current.total);
  assert.equal(breakdown.unassignedErrors, 0);
  assert.equal(breakdown.coveragePercent, 100);
  assert.equal(breakdown.organizationCount, 300);
});
