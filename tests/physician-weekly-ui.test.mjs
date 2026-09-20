import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const monthly = JSON.parse(fs.readFileSync("app/monthly-mo.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));

function parseOperationalPeriod(value) {
  const match = String(value).match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?(?:\s*[–—-]\s*|\s*)(\d{2})\.(\d{2})\.(\d{4})$/u);
  if (!match) return null;
  const year = match[3] ?? match[6];
  return {
    start: new Date(`${year}-${match[2]}-${match[1]}`),
    end: new Date(`${match[6]}-${match[5]}-${match[4]}`),
  };
}

test("partial September 500+ is operational control and does not replace monthly rating", () => {
  assert.match(weekly.date, /^\d{2}\.\d{2}\.2026$/u);
  const period = parseOperationalPeriod(weekly.period);
  assert.ok(period, `invalid operational period: ${weekly.period}`);
  assert.ok(period.start <= period.end);
  assert.match(page, /physician-weekly-snapshot\.json/u);
  assert.match(page, /Оперативный недельный контроль «500\+»/u);
  assert.match(page, /В месячный рейтинг не включается/u);
  assert.match(page, /operational500_/u);
  for (const id of Object.keys(weekly.summary)) {
    assert.ok(physicians.datasets[id].periodType === "month", `${id} must keep the closed monthly dataset`);
    assert.ok(monthly[id], `${id} remains represented by its full-month comparison`);
  }
});
