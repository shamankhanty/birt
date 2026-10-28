import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/page.tsx", "utf8");
const monthly = JSON.parse(fs.readFileSync("app/monthly-mo.json", "utf8"));
const appointments = JSON.parse(fs.readFileSync("app/max-appointments-municipal.json", "utf8"));
const registry = JSON.parse(fs.readFileSync("config/indicator-registry.json", "utf8"));
const periodViews = JSON.parse(fs.readFileSync("app/max-period-views.json", "utf8"));

test("Removing standalone MAX does not alter annual, cumulative or operational source plans", () => {
  assert.equal(registry.indicators.visitMax.plan.value, 654000);
  assert.equal(registry.indicators.tmkMax.plan.value, 193000);
  assert.equal(registry.indicators.elnMax.plan.value, 99000);
  assert.equal(periodViews.operational.metrics.tmk.republicPlan, 16000);
  assert.equal(periodViews.operational.metrics.eln.republicPlan, 8000);
  assert.equal(periodViews.cumulative.metrics.tmk.republicPlan, 161000);
  assert.equal(periodViews.cumulative.metrics.eln.republicPlan, 82000);
  assert.match(page, /data-testid="max-indicator-period-switch"/u);
  assert.match(page, /maxIndicatorSlice = maxPeriodView === "operational" \? maxPeriodViews.operational : maxPeriodViews.cumulative/u);
});

test("MAX regional appointments source remains distinct from organizational data", () => {
  assert.match(registry.indicators.visitMax.name, /записей к врачу на телеконсультацию посредством МАХ/u);
  assert.equal(appointments.dimension, "municipality");
  assert.equal(appointments.bindingToMedicalOrganization, false);
  assert.equal(appointments.totals["2026-08"],6537);
  assert.equal(appointments.totals["2026-09"],12228);
  assert.equal(appointments.totals["2026-10"],4646);
  assert.equal(appointments.grandTotal,45567);
  assert.match(page,/maxAppointmentsMunicipalRaw/u);
});

test("Independent TMC and ELN monthly snapshots keep equal period boundaries", () => {
  for (const id of ["tmkMaxCount","elnMaxCount"]) {
    assert.equal(monthly[id].previousLabel,"На 31.08");
    assert.equal(monthly[id].currentLabel,"На 30.09");
  }
  assert.match(page, /maxAugustMonthlyDataset/u);
  assert.match(page, /maxPeriodViews.operational/u);
  assert.match(page, /maxPeriodViews.cumulative/u);
  assert.doesNotMatch(page, /isMaxMetric\s*\?\s*"ТМК и ЛВН посредством МАХ"/u);
});

test("Missing data remain missing and can never be fabricated as zero", () => {
  assert.match(page, /status: "missing"/u);
  assert.match(page, /Нет строки в выгрузке/u);
  assert.match(page, /maxIndicatorPreviousFact === null/u);
  assert.match(page, /maxIndicatorGrowth/u);
});

test("Section 02 still has TMC and LVN as separate selectable indicators", () => {
  assert.match(page, /"tmkMaxCount",\s*"elnMaxCount",/u);
  assert.match(page, /id === "tmkMaxCount"[\s\S]*?"ТМК посредством МАХ"/u);
  assert.match(page, /id === "elnMaxCount"[\s\S]*?"ЛВН после ТМК посредством МАХ"/u);
  assert.match(page, /matrixMetric === id \? "active" : ""/u);
  assert.match(page, /value=\{matrixMetric\}/u);
  assert.match(page, /data-testid="max-indicator-summary"/u);
  assert.match(page, /data-testid="max-indicator-organization-table"/u);
  assert.doesNotMatch(page, /calculatedIndicatorById\.tmkMaxCount[\s\S]{0,180}\s\/\s[\s\S]{0,180}calculatedIndicatorById\.elnMaxCount/u);
});

test("Standalone MAX page is fully removed from desktop, mobile and rendered sections", () => {
  assert.doesNotMatch(page, /\["max", "МАХ", "12"\]/u);
  assert.doesNotMatch(page, /<span>12<\/span>\s*МАХ/u);
  assert.doesNotMatch(page, /tab === "max"|setTab\("max"\)|<section className="maxSection">/u);
});
