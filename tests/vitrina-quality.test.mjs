import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVitrinaQuality, findVitrinaQualityIssues, VITRINA_SOURCE_COVERAGE, sortVitrinaQualityRows } from "../lib/vitrina-quality.js";

test("Vitrina quality distinguishes observed absence from unverified naming and index warnings", () => {
  const org = {
    id: "test", name: "Тестовая МО", now: 3,
    rows: [
      { name: "Поликлиника", address: ", Татарстан Респ, г. Казань, ул. Ленина, д. 1" },
      { name: "Поликлиника № 2", address: "" },
      { name: "Стоматологическое отделение", address: "420000, Татарстан Респ, г. Казань, ул. Ленина, д. 1" }
    ]
  };
  const issues = findVitrinaQualityIssues(org);
  assert.equal(issues.length, 3);
  assert.equal(issues.filter(item => item.level === "confirmed").length, 1);
  assert.equal(issues.filter(item => item.level === "review").length, 2);
  assert.ok(issues.some(item => item.category === "Наименования" && item.level === "review"));
  assert.ok(issues.some(item => item.category === "Адреса" && item.level === "confirmed"));
  assert.equal(findVitrinaQualityIssues({ ...org, rows: [org.rows[2]] }).length, 0);
});

test("Vitrina quality does not claim to validate specialties, doctors, cabinets or slots", () => {
  for (const key of ["ФРМО / ФРМР", "Специальности", "Кабинеты", "Слоты"]) assert.match(VITRINA_SOURCE_COVERAGE[key], /Нет/);
  const src = readFileSync("app/vitrina-quality-dashboard.tsx", "utf8");
  assert.match(src, /Нет данных для проверки/);
  assert.match(src, /Не рассчитывается/);
  assert.doesNotMatch(src, /Демо-данные|demoData|Math\.random/);
});

test("Vitrina quality preserves source values and ties while sorting", () => {
  const orgs = [
    { id: "a", name: "Больница А", now: 1, rows: [{ name: "Поликлиника", address: "" }] },
    { id: "b", name: "Больница Б", now: 1, rows: [{ name: "Поликлиника № 2", address: "420000, Татарстан Респ, г. Казань, ул. Ленина, д. 1" }] },
  ];
  const original = structuredClone(orgs);
  const result = buildVitrinaQuality(orgs);
  assert.equal(result.organizations, 2);
  assert.equal(result.organizationsWithIssues, 1);
  assert.deepEqual(orgs, original);
  assert.deepEqual(sortVitrinaQualityRows(result.rows).map(row => row.id), ["a", "b"]);
});

test("Vitrina quality keeps presence tracking and quality tracking independent", () => {
  const src = readFileSync("app/vitrina-dashboard.tsx", "utf8");
  assert.match(src, /Наличие расписаний/);
  assert.match(src, /Контроль ошибок/);
  const snapshots = JSON.parse(readFileSync("app/vitrina-snapshots.json", "utf8"));
  assert.equal(snapshots.previous.date, null);
  assert.equal(snapshots.current.date, "23.11.2026");
});
