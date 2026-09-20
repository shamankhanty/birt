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
  for (const id of ["1.1", "18", "20", "25", "26", "29", "34", "36", "39.2", "40", "41", "42", "43"]) {
    assert.match(byId.get(id).sourceNote, /Ручной ввод/u, id);
    assert.match(byId.get(id).regionalPeriod, /2026/u, id);
  }
  assert.equal(byId.get("19").regionalFact, "Нет");
  assert.equal(byId.get("29").regionalFact, "14,25%");
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
  assert.match(page, /operationalRegionalCurrent - regionalPrevious/u);
  assert.doesNotMatch(page, /98\.01741119654318/u);
});
