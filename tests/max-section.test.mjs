import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const monthly = JSON.parse(fs.readFileSync(new URL("../app/monthly-mo.json", import.meta.url), "utf8"));
const visits = JSON.parse(fs.readFileSync(new URL("../app/max-monthly-visits.json", import.meta.url), "utf8"));
const registry = JSON.parse(fs.readFileSync(new URL("../config/indicator-registry.json", import.meta.url), "utf8"));

test("МАХ keeps annual regional plans separate from monthly MO activity", () => {
  assert.equal(registry.indicators.visitMax.plan.value, 654000);
  assert.equal(registry.indicators.tmkMax.plan.value, 193000);
  assert.equal(registry.indicators.elnMax.plan.value, 99000);
  assert.match(page, /Накопительный результат региона отделён от работы медицинских организаций за полный месяц/u);
  assert.match(page, /годовые планы РТ не применяются к отдельным МО/u);
});

test("МАХ preserves the source field and uses the approved management label", () => {
  assert.match(registry.indicators.visitMax.name, /записей к врачу на телеконсультацию посредством МАХ/u);
  assert.match(page, /Запись к врачу посредством МАХ/u);
  assert.match(page, /технический столбец называется «Количество записей к врачу на телеконсультацию»/u);
});

test("August monthly values are derived from equal-boundary cumulative snapshots", () => {
  for (const id of ["tmkMaxCount", "elnMaxCount"]) {
    assert.equal(monthly[id].previousLabel, "На 31.07");
    assert.equal(monthly[id].currentLabel, "На 31.08");
  }
  assert.match(page, /row\.july - row\.june/u);
  assert.match(page, /Срез на 31\.07 нельзя выдавать за месячный объём июля/u);
  assert.equal(visits.previousLabel, "На 31.07");
  assert.equal(visits.currentLabel, "На 31.08");
});

test("missing rows are not converted to zero", () => {
  assert.match(page, /status: "missing"/u);
  assert.match(page, /Нет строки в выгрузке/u);
  assert.match(page, /Отсутствующие данные не заменяются нулём/u);
});
