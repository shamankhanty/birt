import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../app/frmr-mo-workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/frmr-mo-workspace.module.css", import.meta.url), "utf8");
const source = JSON.parse(readFileSync(new URL("../app/frmr-all-specialties.json", import.meta.url), "utf8"));

test("MO screen offers exactly one staff workbench and one separate FRMO table", () => {
  assert.equal((component.match(/<table\b/g) ?? []).length, 2, "employee and FRMO tables only");
  assert.match(component, /workspaceTab === "staff" \? <section/);
  assert.match(component, /Должности ФРМР/);
  assert.match(component, /Сверка СП с ФРМО/);
  assert.doesNotMatch(component, /className=\{styles\.tableCard\}/);
  assert.doesNotMatch(component, /<th>Тип \/ проблема<\/th>/);
  assert.match(css, /\.drillGrid\{display:grid;grid-template-columns:minmax\(215px,.83fr\) minmax\(260px,1.03fr\) minmax\(420px,1.72fr\)/);
});

test("selected role and SP immediately show relevant rows without disclosure or nested accordions", () => {
  assert.match(component, /const activeRole = drillRole && matchingRoles\.some/);
  assert.match(component, /: matchingRoles\[0\]\?\.role \?\? null/);
  assert.match(component, /const activeOid = drillOid && departmentGroups\.some/);
  assert.match(component, /: departmentGroups\[0\]\?\.oid \?\? null/);
  assert.match(component, /filteredEmployees\.slice\(0,recordsShown\)/);
  assert.match(component, /record\[3\]===null \? "Нет данных" : "•••-•••-•"\+record\[3\]/);
  assert.match(component, /record\[3\] !== null && record\[3\]\.includes\(trimmedLast4\)/);
  assert.doesNotMatch(component, /ФИО сотрудника|полный СНИЛС|<details[^>]+>.*Сотрудники/s);
});

test("separate FRMO audit retains cut, warning semantics, and avoids mixing staffing units", () => {
  assert.match(component, /row\.flags\.length \? row\.flags\.map/);
  assert.match(component, /Признаки расхождений — повод для проверки/);
  assert.match(component, /Строк для проверки/);
  assert.match(component, /Отсутствие данных не равно нулю/);
  assert.match(component, /staffRows : auditDisplay/);
  assert.equal(source.summary.sourceCut, "26.11.2026");
  const saby = source.summary.rows.find(row => row[0] === "1126");
  assert.ok(saby);
  assert.equal(saby[4], saby[5] + saby[6]);
});
