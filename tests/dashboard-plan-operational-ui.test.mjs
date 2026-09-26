import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const targets = JSON.parse(fs.readFileSync("config/max-targets-2026.json", "utf8"));
const operational = JSON.parse(fs.readFileSync("app/operational-mo.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));

const countTotal = (id) => operational[id].rows.reduce((sum, row) => sum + row.fact, 0);

test("MAX UI uses the approved target registry and keeps TMK and ELN independent", () => {
  assert.match(page, /max-targets-2026\.json/u);
  assert.match(page, /data-testid="max-plan-summary"/u);
  assert.match(page, /data-testid="max-plan-organization-table"/u);
  assert.match(page, /План текущего месяца/u);
  assert.match(page, /Выполнение, %/u);
  assert.match(page, /Прирост с предыдущей выгрузки/u);
  assert.match(page, /Требуется в день/u);
  assert.match(page, /Сортировка задана по степени невыполнения плана/u);
  assert.match(page, /\(a\.achievement \?\? -1\) - \(b\.achievement \?\? -1\)/u);

  assert.equal(countTotal("tmkMaxCount"), 25_106);
  assert.equal(countTotal("elnMaxCount"), 40_661);
  assert.equal(targets.republic.tmk["2026-09"], 145_000);
  assert.equal(targets.republic.eln["2026-09"], 74_000);
  assert.equal(Number((25_106 / 145_000 * 100).toFixed(2)), 17.31);
  assert.equal(Number((40_661 / 74_000 * 100).toFixed(2)), 54.95);
  assert.equal(145_000 - 25_106, 119_894);
  assert.equal(74_000 - 40_661, 33_339);
  assert.match(page, /maxDashboardRows/u);
  assert.match(page, /Number\.POSITIVE_INFINITY/u);
  assert.match(page, /От наибольшего риска к выполнению/u);
  assert.doesNotMatch(page, /tmk.*\+.*eln|eln.*\+.*tmk/u);
});

test("every 500+ category exposes the closed month beside numerator-derived operational control", () => {
  assert.match(page, /data-testid="physician-monthly-operational-summary"/u);
  assert.match(page, /Месячный результат/u);
  assert.match(page, /используется в рейтинге/u);
  assert.match(page, /Оперативный контроль/u);
  assert.match(page, /operational\.numerator \/ operational\.denominator/u);

  for (const id of Object.keys(weekly.summary).filter((key) => key.startsWith("doctor500_"))) {
    assert.equal(physicians.datasets[id].periodType, "month", `${id}: closed month is retained`);
    const current = weekly.summary[id];
    const previous = weekly.previousSummary[id];
    assert.equal(current.fact, current.numerator / current.denominator * 100, `${id}: current ratio`);
    assert.equal(previous.fact, previous.numerator / previous.denominator * 100, `${id}: previous ratio`);
  }

  const monthlyDentist = physicians.datasets.doctor500_dentist.summary;
  const currentDentist = weekly.summary.doctor500_dentist;
  const previousDentist = weekly.previousSummary.doctor500_dentist;
  assert.deepEqual([monthlyDentist.numerator, monthlyDentist.denominator], [68, 658]);
  assert.deepEqual([previousDentist.numerator, previousDentist.denominator], [23, 661]);
  assert.deepEqual([currentDentist.numerator, currentDentist.denominator], [41, 653]);
  assert.equal(Number(monthlyDentist.fact.toFixed(2)), 10.33);
  assert.equal(Number(previousDentist.fact.toFixed(2)), 3.48);
  assert.equal(Number(currentDentist.fact.toFixed(2)), 6.28);
});
