import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => JSON.parse(fs.readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = read("mo-data.json");
const operational = read("operational-mo.json");
const units = read("unit-data.json");
const status = read("organization-status.json");

test("11.09 hospital report is reconciled exactly", () => {
  assert.equal(mo.hospital.date, "11.09.2026");
  assert.equal(mo.hospital.rows.length, 106);
  assert.equal(mo.hospital.rows.reduce((sum, row) => sum + (row.count ?? 0), 0), 558826);
  assert.equal(Object.values(read("mo-details.json").hospital).reduce((sum, row) => sum + row.volume, 0), 624362);
  assert.equal(mo.hospital.comparisonReset, true);
  const ndrb = mo.hospital.rows.find(row => row.oid === "1.2.643.5.1.13.13.12.2.16.1171");
  assert.equal(ndrb.count, 6584);
  assert.ok(Math.abs(ndrb.fact - 77.52266572471447) < 1e-9);
});

test("11.09 FAP/FP report retains zero units", () => {
  assert.equal(operational.fapSemdCount.date, "11.09.2026");
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.count, 0), 2911671);
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.units, 0), 1673);
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.zeroUnits, 0), 32);
});

test("11.09 ASU SMP report is reconciled to its grand total", () => {
  assert.equal(mo.smp.date, "11.09.2026");
  assert.equal(mo.smp.rows.length, 45);
  assert.equal(mo.smp.rows.reduce((sum, row) => sum + row.volume, 0), 659836);
  assert.equal(mo.smp.rows.reduce((sum, row) => sum + row.registered, 0), 602974);
});

test("remaining 11.09 federal sources are synchronized", () => {
  assert.deepEqual([units.tvspDiagnostic.plan, units.tvspDiagnostic.fact, units.tvspDiagnostic.date], [304, 300, "11.09.2026"]);
  assert.deepEqual([units.smpFederal.plan, units.smpFederal.fact, units.smpFederal.date], [68, 68, "11.09.2026"]);
  assert.equal(status.tmkRemd.date, "11.09.2026");
  assert.equal(status.tmkRemd.rows.filter(row => row.fact > 0).length, 39);
  assert.equal(status.elmk.period, "01.01–11.09.2026");
});

test("each indicator shows its real latest source cut-off", () => {
  const expected = {
    egpu: "11.09.2026", egpu2days: "11.09.2026", birth: "11.09.2026", death: "11.09.2026",
    semd228: "11.09.2026", hospital: "11.09.2026", smp: "11.09.2026",
    tvspStationary: "11.09.2026", tvspAmbulatory: "11.09.2026", tvspLaboratory: "11.09.2026",
    tvspDiagnostic: "11.09.2026", smpFederal: "11.09.2026",
  };
  for (const [metric, date] of Object.entries(expected)) assert.equal(mo[metric].date, date, metric);
  assert.equal(operational.tmkMaxCount.date, "11.09.2026");
  assert.equal(operational.elnMaxCount.date, "11.09.2026");
});
