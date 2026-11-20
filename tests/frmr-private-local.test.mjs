import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync("app/frmr-reconciliation.tsx", "utf8");
const style = fs.readFileSync("app/frmr-reconciliation.module.css", "utf8");
const source = JSON.parse(fs.readFileSync("app/frmr-reconciliation-data.json", "utf8"));

test("medical organizations inspect all three source categories without external files", () => {
  const workspace=fs.readFileSync("app/frmr-mo-workspace.tsx","utf8");
  assert.match(component,/FrmrMoWorkspace key=/u);
  assert.match(workspace,/Должности \/ МО/u);
  assert.match(workspace,/Привязки СП/u);
  assert.match(workspace,/СП ↔ ФРМО/u);
  assert.match(workspace,/Все расхождения выбранной МО/u);
  assert.doesNotMatch(workspace, /type="file"|parseLocalPrivateFrmr|openPrivateWorkbook|FileReader|file\.arrayBuffer/u);
  assert.doesNotMatch(component, /import .*frmr-private-local/u);
});

test("MO details preserve role/SP navigation and only masked identifier suffixes", () => {
  const workspace=fs.readFileSync("app/frmr-mo-workspace.tsx","utf8");
  const styling=fs.readFileSync("app/frmr-mo-workspace.module.css","utf8");
  assert.match(workspace,/active\.staffRecords/u);
  assert.match(workspace,/№ \{record\[5\]\}/u);
  assert.match(workspace,/record\[3\]===null \? "Нет данных" : "•••-•••-•"/u);
  assert.match(workspace,/OID для сверки/u);
  assert.match(workspace,/Нажмите на проблему для детализации/u);
  assert.match(styling,/\.drillGrid/u);
  assert.match(styling,/\.rowButton/u);
  assert.match(style,/moSearchResults/u);
  assert.match(component,/aria-autocomplete="list"/u);
  assert.match(component,/moMatches/u);
  assert.match(component,/row\.id\.includes\(q\)/u);
  assert.match(workspace,/Последние 4 цифры СНИЛС/u);
  assert.doesNotMatch(workspace,/\b\d{11}\b/u);
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
