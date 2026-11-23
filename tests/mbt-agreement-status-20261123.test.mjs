import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const control = JSON.parse(fs.readFileSync(new URL("../app/federal-control.json", import.meta.url), "utf8"));
const oncology = JSON.parse(fs.readFileSync(new URL("../app/oncology-council-current.json", import.meta.url), "utf8"));
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const rows = new Map(control.agreement.map((row) => [row.id, row]));

test("MBT independently counted indicators keep the agreed perimeter and contract categories", () => {
  assert.equal(control.agreement.filter((row) => row.type !== "Компонент").length, 41);
  for (const id of ["6", "8"]) {
    assert.equal(rows.get(id).status, "В контракте");
    assert.equal(rows.get(id).regionalFact, undefined);
  }
});

test("official October reports confirm 100 percent for pregnancy and oncology SEMD", () => {
  for (const [id, letter] of [["34", "44807"], ["35", "44811"]]) {
    const row = rows.get(id);
    assert.equal(row.regionalFact, "100%");
    assert.equal(row.regionalPeriod, "январь–октябрь 2026");
    assert.equal(row.status, "Достигнут");
    assert.match(row.federalSource, new RegExp(letter));
  }
  assert.equal(oncology.fact, 100);
  assert.equal(oncology.date, "31.10.2026");
  assert.match(oncology.source, /44811/u);
  assert.match(page, /import oncologyCouncilCurrent from "\.\/oncology-council-current\.json";/u);
  assert.match(page, /item\.id === "oncologyCouncil"[\s\S]*?fact: oncologyCouncilCurrent\.fact/u);
  // Preserve the old June fallback and apply the October source only at runtime.
  assert.match(page, /id: "oncologyCouncil",[\s\S]*?fact: 50,[\s\S]*?date: "30\.06\.2026"/u);
});

test("seven AI medical devices attain a target of five without reference mode", () => {
  const row = rows.get("40");
  assert.equal(row.regionalFact, "7");
  assert.equal(row.status, "Достигнут");
  assert.equal(row.regionalManualStatus, undefined);
  assert.equal((Number(row.regionalFact) / 5) * 100, 140);
  assert.match(row.sourceNote, /документальная сверка/u);
});
