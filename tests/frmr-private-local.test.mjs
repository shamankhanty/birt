import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync("app/frmr-reconciliation.tsx", "utf8");
const style = fs.readFileSync("app/frmr-reconciliation.module.css", "utf8");
const source = JSON.parse(fs.readFileSync("app/frmr-reconciliation-data.json", "utf8"));

test("medical organizations can inspect errors inline with no Excel or downloadable data", () => {
  assert.match(component, /frmr-organization-diagnostic/u);
  assert.match(component, /Маршрут для МО|маршрут для МО/u);
  assert.match(component, /Поиск по проблемным должностям/u);
  assert.doesNotMatch(component, /Скопировать маршрут проверки/u);
  assert.doesNotMatch(component, /type="file"|parseLocalPrivateFrmr|openPrivateWorkbook|download=|FileReader|file\.arrayBuffer/u);
  assert.doesNotMatch(component, /import .*frmr-private-local/u);
  assert.doesNotMatch(component, /СНИЛС.*r\.snils/u);
});

test("MO details retain department navigation and limited SNILS while omitting flagged text", () => {
  assert.match(component, /frmr-snils-last4-records/u);
  assert.doesNotMatch(component, /Приоритетность корректировки не равна числу расхождений/u);
  assert.match(component, /OID СП/u);
  assert.doesNotMatch(component, /подробный реестр сотрудников должен находиться в защищённом контуре ГИС/u);
  assert.match(component, /selectedDepartment\.oid/u);
  assert.match(component, /ФРМР → трудоустройство/u);
  assert.match(component, /ГИС → сотрудники/u);
  assert.match(component, /resetInspection\(\)/u);
  assert.match(style, /diagnosticLayout/u);
  assert.match(style, /diagnosticRoleActive/u);
  assert.match(style, /moSearchResults/u);
  assert.match(component, /aria-autocomplete="list"/u);
  assert.match(component, /moMatches/u);
  assert.match(component, /row\.id\.includes\(q\)/u);
  assert.doesNotMatch(component, /Скопировать поручение для МО|Маршрут проверки скопирован/u);
  assert.doesNotMatch(component, /Показаны только последние четыре цифры СНИЛС, первые семь удалены/u);
});

test("existing source retains exact source totals without synthesizing unseen names", () => {
  assert.equal(source.sourceCut,"22.10.2026");
  const totals = source.rows.reduce((a,row)=> {
    a.current += row[4]; a.stage1 += row[5]; a.stage2 += row[6]; return a;
  }, {current:0,stage1:0,stage2:0});
  assert.deepEqual(totals,{current:1445,stage1:755,stage2:690});
  assert.equal(source.rows.length,137);
  assert.doesNotMatch(component, /Ива\*\*\*|maskedNamesRaw|frmr-masked-names/u);
});
