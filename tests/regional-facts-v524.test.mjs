import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const control = JSON.parse(fs.readFileSync(new URL("../app/federal-control.json", import.meta.url), "utf8"));
const agreement = new Map(control.agreement.map((row) => [row.id, row]));

test("confirmed v5.2.4 facts remain traceable after v5.2.5 manual additions", () => {
  const firstDay = agreement.get("22");
  assert.equal(firstDay.regionalFact, "959 973 из 6 653 066 · 14,43%");
  assert.equal(firstDay.regionalPeriod, "01.08–31.08.2026");
  assert.match(firstDay.sourceNote, /числитель и знаменатель сверены/u);

  const prescription = agreement.get("39.1");
  assert.equal(prescription.regionalFact, "1 134 434 СЭМД");
  assert.equal(prescription.regionalPeriod, "01.01–07.09.2026");
  assert.equal(prescription.status, "Справочно");
});

test("manual rate of REMD registration errors remains explicitly provisional", () => {
  const errors = agreement.get("29");
  assert.equal(errors.regionalFact, "14,25%");
  assert.match(errors.sourceNote, /Ручной ввод/u);
  assert.match(errors.sourceNote, /знаменателем всех запросов/u);
});
