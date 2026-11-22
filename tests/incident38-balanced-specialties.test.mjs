import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { balancedSpecialties, BALANCED_SPECIALTY_TARGET } from "../lib/incident38-balanced-specialties.js";

const read = name => JSON.parse(readFileSync(new URL("../app/" + name, import.meta.url), "utf8"));
const source = read("incident38-districts.json");

test("Управленческий баланс: цель ровно 70%, избыток по одному профилю не перекрывает ноль другого", () => {
  assert.equal(BALANCED_SPECIALTY_TARGET, 0.70);
  const result = balancedSpecialties([{ norm: 100, epguSlots: 700 }, { norm: 100, epguSlots: 0 }]);
  assert.equal(result.attainment, 50);
  assert.equal(result.cappedSlots, 70);
  assert.equal(result.targetSlots, 140);
  assert.equal(result.zeroSlotCount, 1);
  assert.equal(result.reachedCount, 1);
  assert.equal(result.excessSlots, 630);
});

test("Нулевой норматив исключён, хотя слоты ЕПГУ есть — их нельзя переносить в другие профили", () => {
  const result = balancedSpecialties([{ norm: 0, epguSlots: 500 }, { norm: 100, epguSlots: 35 }]);
  assert.equal(result.attainment, 50);
  assert.equal(result.excludedNormlessSlots, 1);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.cappedSlots, 35);
});

test("Отсутствие данных не равно нулю, отсутствие положительных нормативов не равно 100%", () => {
  for (const rows of [
    [{ norm: null, epguSlots: 10 }],
    [{ norm: 50, epguSlots: null }],
    [{ norm: 0, epguSlots: null }],
    [{ norm: -50, epguSlots: 10 }],
    [{ norm: 50, epguSlots: -1 }],
    [{ norm: 0, epguSlots: 12 }],
    [],
  ]) assert.equal(balancedSpecialties(rows).attainment, null);
});

test("По каждому профилю 70% даёт 100% баланса, перевыполнение не повышает показатель выше 100%", () => {
  assert.equal(balancedSpecialties([{ norm: 100, epguSlots: 70 }, { norm: 300, epguSlots: 210 }]).attainment, 100);
  assert.equal(balancedSpecialties([{ norm: 100, epguSlots: 150 }, { norm: 300, epguSlots: 900 }]).attainment, 100);
  assert.equal(balancedSpecialties([{ norm: 10.5, epguSlots: 3.675 }]).attainment, 50);
});

test("Уруссинская ЦРБ: текущая выборка разоблачает перекос по фтизиатру, И‑38.9 остаётся неизменным", () => {
  const org = source.orgs.find(row => row.oid.endsWith(".1097"));
  assert.ok(org, "Уруссинская ЦРБ найдена по точному OID");
  const balanced = balancedSpecialties(org.specialties);
  const norm = org.specialties.reduce((n, s) => n + s.norm, 0);
  const epgu = org.specialties.reduce((n, s) => n + s.epguSlots, 0);
  const officialPercent = epgu / norm * 100;
  const officialCompletion = officialPercent / 60 * 100;
  const ft = org.specialties.find(s => s.code === "22");
  assert.ok(ft);
  assert.ok(ft.epguSlots > ft.norm * 0.70);
  assert.ok(balanced.attainment < officialCompletion);
  assert.ok(balanced.attainment <= 100);
  assert.equal(balanced.eligibleCount, 13);
  if (source.reportDate === "20.11.2026") {
    assert.ok(Math.abs(officialPercent - 58.35537665324899) < 1e-9);
    assert.ok(Math.abs(balanced.attainment - 57.61932144910868) < 1e-9);
    assert.equal(balanced.reachedCount, 4);
    assert.equal(balanced.zeroSlotCount, 1);
  }
});

test("UI: default rating is balance 70%, official plan 60% remains visible and sortable", () => {
  const component = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  assert.match(component, /key: "balanced", direction: "asc"/);
  assert.match(component, /matrixSort\.key === "balanced"/);
  assert.match(component, /toggleMatrixSort\("balanced"\)/);
  assert.match(component, /toggleMatrixSort\("attainment"\)/);
  assert.match(component, /Сбалансированное выполнение цели 70%/);
  assert.match(component, /управленческий/);
  assert.match(component, /И‑38\.9/);
  assert.match(component, /const PLAN_PERCENT = 60/);
  assert.match(component, /const GOAL_PERCENT = 70/);
  assert.match(component, /zeroSpecialties/);
});
