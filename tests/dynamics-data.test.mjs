import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readJson = async name => JSON.parse(await readFile(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = await readJson("mo-data.json");
const operational = await readJson("operational-mo.json");
const details = await readJson("mo-details.json");

test("full July and August cuts carry comparable dynamics", () => {
  assert.deepEqual(
    Object.fromEntries(["egpu", "egpu2days", "semd228", "ambulatoryCase", "smp"].map(id => [id, mo[id].rows.filter(row => row.trend !== null && row.trend !== 0).length])),
    { egpu: 42, egpu2days: 68, semd228: 93, ambulatoryCase: 121, smp: 45 },
  );
  assert.ok(operational.shortInput.rows.some(row => row.trend > 0));
  assert.ok(operational.shortInput.rows.some(row => row.trend < 0));
});

test("hospital slice uses the verified sheet 3 denominator", () => {
  assert.ok(mo.hospital.rows.some(row => row.previous !== null && row.trend !== null));
  assert.match(mo.hospital.note, /Знаменатель — лист 3/i);
});

test("current source totals reconcile for the refreshed indicators", () => {
  const sum = (id, field) => Object.values(details[id]).reduce((total, row) => total + row[field], 0);
  assert.deepEqual([mo.ambulatoryCase.date, sum("ambulatoryCase", "registered"), sum("ambulatoryCase", "volume")], ["29.08.2026", 9549272, 10948601]);
  assert.deepEqual([mo.hospital.date, sum("hospital", "registered"), sum("hospital", "volume")], ["07.09.2026", 514249, 612631]);
  assert.deepEqual(
    [operational.shortInput.date, operational.shortInput.rows.reduce((total, row) => total + row.fact, 0), operational.shortInputAmb.rows.reduce((total, row) => total + row.fact, 0), operational.shortInputHosp.rows.reduce((total, row) => total + row.fact, 0)],
    ["07.09.2026", 694560, 685066, 9494],
  );
});

test("ambulance-card rows reconcile to the source total without duplicates", () => {
  assert.equal(mo.smp.rows.length, 45);
  assert.equal(new Set(mo.smp.rows.map(row => row.name)).size, 45);
  assert.equal(Object.values(details.smp).reduce((sum, row) => sum + row.volume, 0), 624216);
  assert.equal(Object.values(details.smp).reduce((sum, row) => sum + row.registered, 0), 576237);
});

test("TVSP subunit aggregations remain separate from federal building totals", () => {
  const expected = {
    tvspStationary: "07.09.2026",
    tvspAmbulatory: "07.09.2026",
    tvspLaboratory: "07.09.2026",
  };
  for (const [id, date] of Object.entries(expected)) {
    assert.ok(Object.values(details[id]).reduce((sum, row) => sum + row.volume, 0) > 0);
    assert.equal(mo[id].date, date);
  }
});

test("birth data excludes the source legend row", () => {
  assert.ok(mo.birth.rows.every(row => !row.name.startsWith("Где в столбце")));
});
