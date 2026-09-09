import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const control = JSON.parse(fs.readFileSync("app/federal-control.json", "utf8"));
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
  assert.match(page, /Официальный накопительный результат не используется в недельной или месячной динамике МО/u);
  assert.match(styles, /\.maxOfficialBlock/u);
  assert.match(styles, /\.maxOperationalBlock/u);
});

test("physician applicability requires the relevant level and source role", () => {
  assert.match(page, /id === "doctorsLevel3"\) return registry\.level === "III уровень"/u);
  assert.match(page, /Boolean\(physicianRow && \(physicianRow\.volume \?\? 0\) > 0\)/u);
});

test("EPGU weekly comparison uses 31 August and 7 September source cuts", () => {
  assert.match(page, /egpu: \{ previous: "01\.01–31\.08\.2026", current: "01\.01–07\.09\.2026" \}/u);
  assert.match(page, /egpu: \(29814 \/ 30260\) \* 100/u);
});
