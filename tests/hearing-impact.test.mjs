import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("hearing priority is based on contribution to the regional shortfall", () => {
  assert.match(source, /targetCount = \(metric\.plan \/ 100\) \* metric\.volume/);
  assert.match(source, /deficitCount = Math\.max\(0, targetCount - metric\.count\)/);
  assert.match(source, /regionalContribution: \(deficitCount \/ regionalDenominator\) \* 100/);
  assert.match(source, /b\.regionalContribution - a\.regionalContribution/);
});

test("full MO profile preserves management statuses", () => {
  for (const label of ["Влияет на приоритет", "Справочно", "Нет данных", "Неприменимо"])
    assert.match(source, new RegExp(label));
  assert.match(source, /Object\.keys\(moData\)\.forEach/);
});

test("REMD errors and KDL do not enter the influence calculation", () => {
  assert.match(source, /id: "remd-registration-errors"/);
  assert.match(source, /affectsPriority: false/);
  assert.match(source, /metric\.id !== "tvspLaboratory"/);
});
