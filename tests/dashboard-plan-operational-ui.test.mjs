import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const targets = JSON.parse(fs.readFileSync("config/max-targets-2026.json", "utf8"));
const operational = JSON.parse(fs.readFileSync("app/operational-mo.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const periodViews = JSON.parse(fs.readFileSync("app/max-period-views.json", "utf8"));

const countTotal = (id) => operational[id].rows.reduce((sum, row) => sum + row.fact, 0);

test("MAX UI uses the approved target registry and keeps TMK and ELN independent", () => {
  assert.match(page, /max-targets-2026\.json/u);
  assert.match(page, /data-testid="max-plan-summary"/u);
  assert.match(page, /data-testid="max-plan-organization-table"/u);
  assert.match(page, /Месячный план/u);
  assert.match(page, /Выполнение, %/u);
  assert.match(page, /Динамика/u);
  assert.match(page, /Нужно до конца месяца/u);
  assert.match(page, /Рейтинг по прогнозному выполнению месячного плана/u);
  assert.match(page, /forecastAchievement/u);

  assert.equal(countTotal("tmkMaxCount"), 68_049);
  // One source row is explicitly "Неизвестная МО" and is not part of the
  // resolved plan perimeter shown by the UI.
  assert.equal(periodViews.operational.metrics.tmk.plannedMoFact, 10229);
  assert.equal(periodViews.operational.metrics.eln.plannedMoFact, 8572);
  assert.equal(countTotal("elnMaxCount"), 51_879);
  assert.equal(targets.republic.tmk["2026-09"], 145_000);
  assert.equal(targets.republic.eln["2026-09"], 74_000);
  assert.equal(Number((60_015 / 145_000 * 100).toFixed(2)), 41.39);
  assert.equal(Number((45_937 / 74_000 * 100).toFixed(2)), 62.08);
  assert.equal(145_000 - 60_015, 84_985);
  assert.equal(74_000 - 45_937, 28_063);
  assert.match(page, /maxDashboardRows/u);
  assert.match(page, /Number\.POSITIVE_INFINITY/u);
  assert.match(page, /От наибольшего риска к выполнению/u);
  assert.doesNotMatch(page, /tmk.*\+.*eln|eln.*\+.*tmk/u);
});

test("block 02 MAX indicators use direct monthly and cumulative source-backed views", () => {
  assert.match(page, /data-testid="max-indicator-period-switch"/u);
  assert.match(page, /data-testid="max-indicator-summary"/u);
  assert.match(page, /data-testid="max-indicator-organization-table"/u);
  assert.match(page, /const maxSidebarSnapshot = \(id: string\)/u);
  assert.match(page, /Оперативно \$\{slice\.date\.slice\(0, 5\)\}/u);
  assert.match(page, /Накопительно \$\{slice\.date\.slice\(0, 5\)\}/u);
  assert.match(page, /Факт взят напрямую из октябрьского отчёта; накопительный факт сентября из него не вычитается/u);
  assert.match(page, /maxIndicatorSlice = maxPeriodView === "operational" \? maxPeriodViews\.operational : maxPeriodViews\.cumulative/u);
  assert.equal(periodViews.operational.metrics.tmk.plannedMoFact, 10229);
  assert.equal(periodViews.operational.metrics.tmk.republicPlan, 16000);
  assert.equal(periodViews.operational.metrics.eln.plannedMoFact, 8572);
  assert.equal(periodViews.operational.metrics.eln.republicPlan, 8000);
  assert.equal(periodViews.cumulative.metrics.tmk.plannedMoFact, 66483);
  assert.equal(periodViews.cumulative.metrics.tmk.republicPlan, 161000);
  assert.equal(periodViews.cumulative.metrics.eln.plannedMoFact, 51388);
  assert.equal(periodViews.cumulative.metrics.eln.republicPlan, 82000);
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
  assert.deepEqual([monthlyDentist.numerator, monthlyDentist.denominator], [152, 652]);
  assert.deepEqual([previousDentist.numerator, previousDentist.denominator], [78, 609]);
  assert.deepEqual([currentDentist.numerator, currentDentist.denominator], [126, 604]);
  assert.equal(Number(monthlyDentist.fact.toFixed(2)), 23.31);
  assert.equal(Number(previousDentist.fact.toFixed(2)), 12.81);
  assert.equal(Number(currentDentist.fact.toFixed(2)), 20.86);
});
