import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("app/frmr-reconciliation-data.json","utf8"));
const component = fs.readFileSync("app/frmr-reconciliation.tsx","utf8");
const page = fs.readFileSync("app/page.tsx","utf8");
const sum = (index) => data.rows.reduce((acc, row) => acc + (row[index] ?? 0), 0);

test("FRMR/GIS snapshot reconciles to both independent organization summary and position flags", () => {
  assert.equal(data.schemaVersion,1);
  assert.equal(data.sourceCut,"22.10.2026");
  assert.equal(data.rows.length,137);
  assert.equal(sum(2),2836);
  assert.equal(sum(3),1477);
  assert.equal(sum(4),1445);
  assert.equal(sum(5),755);
  assert.equal(sum(6),690);
  assert.equal(sum(7),7279);
  assert.equal(sum(5)+sum(6),sum(4));
  assert.equal(data.rows.filter(row=>row[4]>0).length,115);
  assert.deepEqual(data.trend,[["01.02.2026",2836],["16.10.2026",1477],["22.10.2026",1445]]);
  assert.equal(new Set(data.rows.map(row=>row[0])).size,data.rows.length);
  for (const row of data.rows) {
    assert.equal(row.length,9);
    assert.equal(row[4],row[5]+row[6],row[1]);
    assert.ok(row[4]>=0 && row[4]<=row[7],row[1]);
    assert.ok(row[8].every(spec=>spec[1]>=3),row[1]);
  }
});
test("public manager and MO dashboards do not carry per-person identifiers", () => {
  const raw=JSON.stringify(data);
  assert.doesNotMatch(raw,/СНИЛС|ФИО врача|телефон сотрудника|дата рождения/iu);
  assert.doesNotMatch(raw,/\b\d{3}-\d{3}-\d{3} \d{2}\b/u);
  assert.match(component,/>Обзор<\/button>/u);
  assert.doesNotMatch(component,/Обзор для министра|Что должен видеть министр/u);
  assert.match(component,/Должности с наибольшим числом расхождений/u);
  assert.match(component,/Карточка МО и действия/u);
  assert.match(component,/не подтверждено/u);
  assert.match(component,/Поиск медицинской организации/u);
  assert.match(component,/К общей сводке/u);
  assert.doesNotMatch(component,/Скопировать поручение для МО/u);
});
test("FRMR/GIS is promoted to primary desktop and mobile navigation without changing rating calculations", () => {
  assert.match(page,/import FrmrReconciliation from "\.\/frmr-reconciliation"/u);
  assert.match(page,/\| "frmr"/u);
  assert.match(page,/\["frmr", "ФРМР ↔ ГИС/u);
  assert.match(page,/tab === "frmr" && <FrmrReconciliation/u);
  assert.match(page,/\["frmr", "ФРМР ↔ ГИС", "06"\]/u);
  assert.match(page,/<span>06<\/span> ФРМР ↔ ГИС/u);
  assert.doesNotMatch(page,/developmentSection \$\{tab === "frmr"/u);
  assert.doesNotMatch(component,/physicianMetrics\.datasets/u);
});
