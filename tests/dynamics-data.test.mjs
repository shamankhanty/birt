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
  assert.deepEqual(
    Object.fromEntries(["egpu", "egpu2days", "semd228", "ambulatoryCase", "smp"].map(id => [id, mo[id].rows.filter(row => row.trend !== null && row.trend !== 0).length])),
    { egpu: 46, egpu2days: 66, semd228: 93, ambulatoryCase: 120, smp: 45 },
  );
  assert.ok(operational.shortInput.rows.some(row => row.trend > 0));
  assert.ok(operational.shortInput.rows.some(row => row.trend < 0));
});

test("hospital slice uses REMD numerator and hospital-case denominator without incomparable dynamics", () => {
  assert.equal(mo.hospital.comparisonReset, true);
  assert.ok(mo.hospital.rows.every(row => row.previous === null && row.trend === null));
  assert.match(mo.hospital.note, /числитель.*РЭМД ЕГИСЗ/i);
  assert.match(mo.hospital.note, /знаменатель.*госпитализац/i);
});

test("current source totals reconcile for the refreshed indicators", () => {
  const sum = (id, field) => Object.values(details[id]).reduce((total, row) => total + row[field], 0);
  assert.deepEqual([mo.ambulatoryCase.date, sum("ambulatoryCase", "registered"), sum("ambulatoryCase", "volume")], ["11.09.2026", 10182100, 11491246]);
  assert.deepEqual([mo.hospital.date, sum("hospital", "registered"), sum("hospital", "volume")], ["11.09.2026", 558826, 624362]);
  assert.deepEqual(
    [operational.shortInput.date, operational.shortInput.rows.reduce((total, row) => total + row.fact, 0), operational.shortInputAmb.rows.reduce((total, row) => total + row.fact, 0), operational.shortInputHosp.rows.reduce((total, row) => total + row.fact, 0)],
    ["11.09.2026", 710168, 701402, 8766],
  );
  assert.equal(semdSummary.period, "01.01.2026–11.09.2026");
  assert.equal(semdSummary.total, 65254256);
  assert.equal(errorCategories.period, "07.09.2026–13.09.2026");
  assert.equal(errorCategories.total, 2046140);
  assert.match(pageSource, /value: sumDatasetFacts\(moData\.shortInput\)/);
  assert.match(pageSource, /value: extendedHospitalTotals\.volume/);
  assert.match(pageSource, /value: sumDatasetFacts\(moData\.fapSemdCount\)/);
  assert.match(pageSource, /value: errorCategories\.total/);
});

test("ambulance-card rows reconcile to the source total without duplicates", () => {
  assert.equal(mo.smp.rows.length, 45);
  assert.equal(new Set(mo.smp.rows.map(row => row.name)).size, 45);
  assert.equal(Object.values(details.smp).reduce((sum, row) => sum + row.volume, 0), 659836);
  assert.equal(Object.values(details.smp).reduce((sum, row) => sum + row.registered, 0), 602974);
});

test("TVSP subunit aggregations remain separate from federal building totals", () => {
  const expected = {
    tvspStationary: "11.09.2026",
    tvspAmbulatory: "11.09.2026",
    tvspLaboratory: "11.09.2026",
  };
  for (const [id, date] of Object.entries(expected)) {
    assert.ok(Object.values(details[id]).reduce((sum, row) => sum + row.volume, 0) > 0);
    assert.equal(mo[id].date, date);
  }
});

test("birth data excludes the source legend row", () => {
  assert.ok(mo.birth.rows.every(row => !row.name.startsWith("Где в столбце")));
});
