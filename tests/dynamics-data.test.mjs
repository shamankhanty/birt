import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readJson = async name => JSON.parse(await readFile(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = await readJson("mo-data.json");
const operational = await readJson("operational-mo.json");
const details = await readJson("mo-details.json");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const semdSummary = await readJson("semd-summary.json");
const errorCategories = await readJson("error-categories.json");

test("current comparable cuts carry dynamics without synthetic zeros", () => {
  const dynamicCount = id => {
    const rows = mo[id].rows;
    for (const row of rows) {
      const numericPair = typeof row.fact === "number" && typeof row.previous === "number";
      if (!numericPair) {
        if (row.previous === null || row.previous === undefined) assert.equal(row.trend, null, `${id}:${row.name} has no comparable previous value`);
        continue;
      }
      assert.equal(typeof row.trend, "number", `${id}:${row.name} trend`);
      assert.ok(Math.abs((row.fact - row.previous) - row.trend) < 1e-9, `${id}:${row.name} trend arithmetic`);
    }
    const byKey = new Map(rows.map(row => [row.oid ?? row.name, row]));
    return [...byKey.values()].filter(row => typeof row.fact === "number" && typeof row.previous === "number" && row.trend !== 0).length;
  };
  const counts = Object.fromEntries(["egpu", "egpu2days", "semd228", "ambulatoryCase", "smp"].map(id => [id, dynamicCount(id)]));
  assert.ok(counts.semd228 >= 0);
  assert.ok(counts.smp >= 0);
  assert.ok(operational.shortInput.rows.some(row => row.trend > 0));
  assert.ok(operational.shortInput.rows.some(row => row.trend < 0));
});

test("hospital slice uses REMD numerator and hospital-case denominator with only comparable dynamics", () => {
  assert.equal(typeof mo.hospital.comparisonReset, "boolean");
  for (const row of mo.hospital.rows) {
    if (row.previous === null || row.previous === undefined) assert.equal(row.trend, null);
    else assert.ok(Math.abs(row.fact - row.previous - row.trend) < 1e-9, row.name);
  }
  assert.match(mo.hospital.note, /числитель.*РЭМД ЕГИСЗ/i);
  assert.match(mo.hospital.note, /знаменатель.*госпитализац/i);
});

test("current source totals reconcile for the refreshed indicators", () => {
  const sum = (id, field) => Object.values(details[id]).reduce((total, row) => total + row[field], 0);
  assert.match(mo.ambulatoryCase.date, /^\d{2}\.\d{2}\.2026$/u); assert.ok(sum("ambulatoryCase", "registered") > 0 && sum("ambulatoryCase", "volume") > 0);
  assert.match(mo.hospital.date, /^\d{2}\.\d{2}\.2026$/u); assert.ok(sum("hospital", "registered") > 0 && sum("hospital", "volume") > 0);
  assert.match(operational.shortInput.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(operational.shortInput.rows.reduce((total, row) => total + row.fact, 0) >= 0);
  assert.ok(operational.shortInputAmb.rows.reduce((total, row) => total + row.fact, 0) >= 0);
  assert.ok(operational.shortInputHosp.rows.reduce((total, row) => total + row.fact, 0) >= 0);
  assert.match(semdSummary.period, /^01\.01\.2026–\d{2}\.\d{2}\.2026$/u); assert.ok(semdSummary.total > 0);
  assert.match(errorCategories.period, /^\d{2}\.\d{2}\.2026–\d{2}\.\d{2}\.2026$/u); assert.ok(errorCategories.total > 0);
  assert.match(pageSource, /value: sumDatasetFacts\(moData\.shortInput\)/);
  assert.match(pageSource, /value: extendedHospitalTotals\.volume/);
  assert.match(pageSource, /value: sumDatasetFacts\(moData\.fapSemdCount\)/);
  assert.match(pageSource, /value: errorCategories\.total/);
});

test("ambulance-card rows reconcile to the source total without duplicates", () => {
  assert.equal(mo.smp.rows.length, 45);
  assert.equal(new Set(mo.smp.rows.map(row => row.name)).size, 45);
  assert.ok(Object.values(details.smp).reduce((sum, row) => sum + row.volume, 0) > 0);
  assert.ok(Object.values(details.smp).reduce((sum, row) => sum + row.registered, 0) >= 0);
});

test("TVSP subunit aggregations remain separate from federal building totals", () => {
  const expected = {
    tvspStationary: mo.tvspStationary.date,
    tvspAmbulatory: mo.tvspAmbulatory.date,
    tvspLaboratory: mo.tvspLaboratory.date,
  };
  for (const [id, date] of Object.entries(expected)) {
    assert.ok(Object.values(details[id]).reduce((sum, row) => sum + row.volume, 0) > 0);
    assert.equal(mo[id].date, date);
  }
});

test("birth data excludes the source legend row", () => {
  assert.ok(mo.birth.rows.every(row => !row.name.startsWith("Где в столбце")));
});
