import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(new URL('../app/remd-registration-time.json', import.meta.url), 'utf8'));

test('registration-time video rows are complete, ordered, and separate from the one-day share', () => {
  assert.equal(data.rows.length, 118);
  assert.equal(data.period, '01.11–17.11.2026');
  assert.match(data.methodNote, /Не является долей СЭМД/);
  for (const [index, row] of data.rows.entries()) {
    assert.equal(row.rank, index + 1);
    assert.ok(row.name.length > 0);
    assert.ok(Number.isInteger(row.hours) && row.hours >= 0);
    assert.ok(Number.isInteger(row.minutes) && row.minutes >= 0 && row.minutes < 60);
    if (index > 0) assert.ok(row.hours * 60 + row.minutes <= data.rows[index - 1].hours * 60 + data.rows[index - 1].minutes);
    if (row.note) assert.match(row.name, /\.\.\./);
  }
});
