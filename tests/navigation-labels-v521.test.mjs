import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const registry = JSON.parse(fs.readFileSync(new URL('../config/indicator-registry.json', import.meta.url), 'utf8'));

test('v5.2.1 uses MSR/MSS names and the approved main navigation order', () => {
  assert.equal(registry.indicators.birth.name, 'МСР');
  assert.equal(registry.indicators.death.name, 'МСС');
  assert.match(page, /const DASHBOARD_VERSION = "5\.2\.1";/);

  const mainItems = [
    '["unified", "Расширенная сводка", "01"]',
    '["matrix", "Показатели", "02"]',
    '["ranking", "Рейтинг МО", "03"]',
    '["hearings", "МО для заслушивания", "04"]',
    '["max", "МАХ", "05"]',
    '["waybill", "Электронный путевой лист", "06"]',
    '["remdErrors", "Ошибки РЭМД", "07"]',
  ];
  let last = -1;
  for (const item of mainItems) {
    const index = page.indexOf(item);
    assert.ok(index > last, `${item} must follow the approved order`);
    last = index;
  }

  const divider = page.indexOf('["divider", "В разработке", ""]');
  const federal = page.indexOf('["federal", "Показатели на контроле РФ", "08"]');
  const methods = page.indexOf('["methods", "Методики расчёта", "09"]');
  const history = page.indexOf('["history", "История обновлений", "10"]');
  const semd = page.indexOf('["semd", "Все виды СЭМД", "11"]');
  const errors = page.indexOf('["errors", "Ошибки методик", "12"]');
  assert.ok(last < divider && divider < federal && federal < methods && methods < history && history < semd && semd < errors);

  assert.ok(!page.includes('developmentSection ${tab === "ranking"'));
  assert.ok(page.includes('className={`developmentSection ${tab === "federal" ? "active" : ""}`}'));
  assert.ok(!page.includes('Доля медицинских свидетельств о рождении относительно актов гражданского состояния'));
  assert.ok(!page.includes('Доля медицинских свидетельств о смерти относительно актов гражданского состояния'));
  assert.ok(!page.includes('Доля медицинских свидетельств о смерти относительно общего количества актов гражданского состояния'));
});
