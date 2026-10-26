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
  assert.match(component, /Скопировать маршрут проверки/u);
  assert.doesNotMatch(component, /type="file"|parseLocalPrivateFrmr|openPrivateWorkbook|download=|FileReader|file\.arrayBuffer/u);
  assert.doesNotMatch(component, /import .*frmr-private-local/u);
  assert.doesNotMatch(component, /СНИЛС.*r\.snils/u);
});

test("MO detail makes clear that reasons are MO-wide and employee and department mappings unavailable", () => {
  assert.match(component, /Категории ошибок по отдельной должности/u);
  assert.match(component, /не опубликованы/u);
  assert.match(component, /OID СП/u);
  assert.match(component, /без первичных идентификаторов нельзя привязать/u);
  assert.match(component, /ФРМР → трудоустройство/u);
  assert.match(component, /ГИС → сотрудники/u);
  assert.match(component, /resetInspection\(\)/u);
  assert.match(style, /diagnosticLayout/u);
  assert.match(style, /diagnosticRoleActive/u);
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
