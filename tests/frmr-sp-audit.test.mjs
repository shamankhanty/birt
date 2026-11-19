import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("../app/frmr-sp-audit-20261119.json", import.meta.url)));
test("ФРМО СП: source dates and rows remain separate from the staffing control", () => {
  assert.equal(data.sourceCut, "19.11.2026");
  assert.equal(data.previousCut, "09.11.2026");
  assert.equal(data.historicCut, "08.09.2025");
  assert.equal(data.records.length, 2832);
  assert.equal(data.summarySourceCount, 141);
  assert.equal(data.summary.length, 148);
  assert.equal(data.summary.filter(m => m.current === null).length, 7);
  assert.equal(data.records.filter(r => r.flags.includes("oid")).length, 977);
  assert.ok(data.records.every(r => data.summary.some(m => m.id === r.mo)));
  assert.ok(data.records.every(r => !Object.keys(r).some(k => /снилс|surname|firstName/i.test(k))));
});
