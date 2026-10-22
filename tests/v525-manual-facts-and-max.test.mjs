import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCurrentOperationalRuntime } from "../lib/current-operational-runtime.js";

const control = JSON.parse(fs.readFileSync("app/federal-control.json", "utf8"));
const mo = JSON.parse(fs.readFileSync("app/mo-data.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");
const styles = fs.readFileSync("app/globals.css", "utf8");

test("v5.2.5 marks agreed RT facts as manual until primary reports arrive", () => {
  const byId = new Map(control.agreement.map((row) => [row.id, row]));
  assert.equal(byId.get("24").regionalFact, "35 из 35 · 100%");
  for (const id of ["1.1", "18", "20", "25", "26", "34", "36", "40"]) {
    assert.match(byId.get(id).sourceNote, /Ручной ввод/u, id);
    assert.match(byId.get(id).regionalPeriod, /2026/u, id);
  }
  assert.equal(byId.get("19").regionalFact, "Нет");
  assert.equal(byId.get("18").regionalFact, "21,34%");
  assert.equal(byId.get("18").regionalPeriod, "01.01.2026–21.10.2026");
  assert.equal(byId.get("29").regionalFact, "16,62%");
  assert.equal(byId.get("29").regionalPeriod, "01.01.2026–21.10.2026");
  assert.match(byId.get("29").sourceNote, /Ручной ввод по сообщённому значению/u);
  assert.match(byId.get("29").sourceNote, /без первичной регулярной выгрузки/u);
  assert.match(byId.get("39.2").sourceNote, /Подтвержденное количество/u);
  assert.equal(byId.get("39.2").regionalFact, "18 777 СЭМД");
});

test("AI imaging shares use source numerators/denominators and one-decimal rounding", () => {
  const byId = new Map(control.agreement.map((row) => [row.id, row]));
  const cases = [
    ["41", 10_110, 255_802, "4,0%"],
    ["42", 69_556, 1_421_014, "4,9%"],
    ["43", 10_188, 125_561, "8,1%"],
  ];
  for (const [id, numerator, denominator, displayed] of cases) {
    const row = byId.get(id);
    assert.equal(row.regionalFact, displayed, `indicator ${id}`);
    assert.equal(row.regionalPeriod, "01.01.2026–31.08.2026", `indicator ${id}`);
    assert.equal((numerator / denominator * 100).toFixed(1).replace(".", ",") + "%", displayed);
    assert.match(row.sourceNote, /скриншот/u);
    assert.equal(row.status, "Отклонение");
    assert.equal(row.plan.slice(0, 3), "25%");
  }
});

test("MAX separates official RT results from operational MO monitoring", () => {
  assert.match(page, /ОФИЦИАЛЬНО ПО РЕСПУБЛИКЕ ТАТАРСТАН/u);
  assert.match(page, /ОПЕРАТИВНО ПО МО/u);
  assert.match(page, /Официальный накопительный результат не смешивается с оперативной динамикой между выгрузками и с месячной динамикой МО/u);
  assert.match(styles, /\.maxOfficialBlock/u);
  assert.match(styles, /\.maxOperationalBlock/u);
});

test("physician applicability requires the relevant level and source role", () => {
  assert.match(page, /id === "doctorsLevel3"\) return registry\.level === "III уровень"/u);
  assert.match(page, /Boolean\(physicianRow && \(physicianRow\.volume \?\? 0\) > 0\)/u);
});

test("EPGU operational comparison uses runtime source cuts", () => {
  assert.match(page, /currentOperationalRuntime/u);
  assert.doesNotMatch(page, /egpu: \{ previous:/u);
  const runtime = createCurrentOperationalRuntime({ moData: mo });
  assert.match(runtime.egpu.previousDate, /^\d{2}\.\d{2}\.2026$/u);
  assert.equal(typeof runtime.egpu.numerator, "number");
  assert.equal(typeof runtime.egpu.denominator, "number");
  const previousFact = (runtime.egpu.numerator / runtime.egpu.denominator) * 100;
  assert.equal(runtime.egpu.derivedFact, previousFact);
  const delta = (runtime.egpu.fact ?? previousFact) - previousFact;
  assert.equal(typeof delta, "number");
  assert.match(page, /operationalRegionalCurrent - effectiveRegionalPrevious/u);
  assert.doesNotMatch(page, /98\.01741119654318/u);
});
