import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const adapters = fs.readFileSync(new URL("../scripts/pipeline/adapters.py", import.meta.url), "utf8");
const mo = JSON.parse(fs.readFileSync(new URL("../app/mo-data.json", import.meta.url), "utf8"));
const operational = JSON.parse(fs.readFileSync(new URL("../app/operational-mo.json", import.meta.url), "utf8"));
const status = JSON.parse(fs.readFileSync(new URL("../app/organization-status.json", import.meta.url), "utf8"));

test("indicator operational mode means current export versus previous export", () => {
  assert.match(page, /useState<"operational" \| "month">\("operational"\)/u);
  assert.match(page, /Оперативно — текущая выгрузка к предыдущей/u);
  assert.match(page, /Предыдущая выгрузка/u);
  assert.match(page, /Текущая выгрузка/u);
  assert.match(page, /<small>Разница<\/small>/u);
  assert.match(page, /snapshotDistanceDays/u);
});

test("current operational comparison map identifies the previous source export", () => {
  assert.match(page, /Object\.fromEntries\(Object\.entries\(currentOperationalRuntime\)/u);
  assert.doesNotMatch(page, /birth: \{ previous:/u);
  assert.doesNotMatch(page, /tmkMaxCount: \{ previous:/u);
});

test("regional cards use the approved previous export totals, not partial row matching", () => {
  assert.match(page, /tmkMaxCount: 20942/u);
  assert.match(page, /elnMaxCount: 35948/u);
  assert.match(page, /shortInput: 692864/u);
  assert.match(page, /hospital: 83\.94106729825947/u);
  assert.match(page, /selectedUnitDataset\.fact \/ selectedUnitDataset\.plan/u);
});

test("weekly update adapters carry previous cut metadata forward", () => {
  assert.match(adapters, /def previous_cut_metadata/u);
  assert.match(adapters, /previousDate/u);
  assert.match(adapters, /previousPeriod/u);
  assert.match(adapters, /adapt_ambulatory_cases[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_preventive[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_short_input[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_fap[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_asu_smp[\s\S]*previous_cut_metadata/u);
});

test("count tables show dates, absolute difference and relative change", () => {
  assert.match(page, /Текущая выгрузка[\s\S]*currentSnapshot/u);
  assert.match(page, /Предыдущая выгрузка[\s\S]*previousSnapshot/u);
  assert.match(page, /Изменение, %/u);
  assert.match(page, /o\.trend \/ o\.previous/u);
  assert.match(page, /новое значение/u);
});

const physicianMonthly = JSON.parse(fs.readFileSync(new URL("../app/physician-metrics.json", import.meta.url), "utf8"));
const physicianWeekly = JSON.parse(fs.readFileSync(new URL("../app/physician-weekly-snapshot.json", import.meta.url), "utf8"));

test("doctorsAll operational snapshot is shown instead of September monthly result", () => {
  assert.equal(physicianMonthly.datasets.doctorsAll.summary.numerator, 10674);
  assert.equal(physicianMonthly.datasets.doctorsAll.summary.denominator, 13542);
  assert.equal(physicianMonthly.datasets.doctorsAll.period, "сентябрь 2026");
  assert.equal(physicianWeekly.summary.doctorsAll.numerator, 10875);
  assert.equal(physicianWeekly.summary.doctorsAll.denominator, 13691);
  assert.equal(physicianWeekly.previousSummary.doctorsAll.numerator, 10635);
  assert.equal(physicianWeekly.previousSummary.doctorsAll.denominator, 13671);
  assert.equal(physicianWeekly.periods.doctorsAll.date, "24.10.2026");
  assert.equal(physicianWeekly.previousPeriods.doctorsAll.date, "21.10.2026");
  assert.match(page, /const isOperationalPhysicianSnapshot =[\s\S]*?isPhysicianMetric\(matrixMetric\)/u);
  assert.match(page, /const physicianOperationalSummary = isOperationalPhysicianSnapshot/u);
  assert.match(page, /const indicatorRows = \(isOperationalPhysicianSnapshot/u);
  assert.match(page, /const operationalRegionalCurrent = isOperationalPhysicianSnapshot/u);
  assert.match(page, /const regionalPrevious = isOperationalPhysicianSnapshot/u);
  assert.match(page, /Месячный результат и рейтинг остаются за/u);
});

test("doctorsLevel3 operational snapshot retains both comparable October cuts", () => {
  assert.deepEqual(
    [physicianWeekly.summary.doctorsLevel3.numerator, physicianWeekly.summary.doctorsLevel3.denominator],
    [3970, 4888],
  );
  assert.deepEqual(
    [physicianWeekly.previousSummary.doctorsLevel3.numerator, physicianWeekly.previousSummary.doctorsLevel3.denominator],
    [3847, 4882],
  );
  assert.equal(physicianWeekly.periods.doctorsLevel3.date, "24.10.2026");
  assert.equal(physicianWeekly.previousPeriods.doctorsLevel3.date, "21.10.2026");
  assert.ok(physicianWeekly.datasets.doctorsLevel3.length > 0);
  assert.ok(physicianWeekly.previousDatasets.doctorsLevel3.length > 0);
});
