import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => JSON.parse(fs.readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = read("mo-data.json");
const operational = read("operational-mo.json");
const units = read("unit-data.json");
const status = read("organization-status.json");

test("07.09 hospital report is reconciled exactly", () => {
  assert.equal(mo.hospital.date, "07.09.2026");
  assert.equal(mo.hospital.rows.length, 106);
  assert.equal(mo.hospital.rows.reduce((sum, row) => sum + row.count, 0), 514249);
  assert.equal(Object.values(read("mo-details.json").hospital).reduce((sum, row) => sum + row.volume, 0), 612631);
});

test("07.09 FAP/FP report retains zero units", () => {
  assert.equal(operational.fapSemdCount.date, "07.09.2026");
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.count, 0), 2868210);
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.units, 0), 1675);
  assert.equal(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.zeroUnits, 0), 38);
});

test("28.08 ASU SMP report is reconciled to its grand total", () => {
  assert.equal(mo.smp.date, "28.08.2026");
  assert.equal(mo.smp.rows.length, 45);
  assert.equal(mo.smp.rows.reduce((sum, row) => sum + row.volume, 0), 624216);
  assert.equal(mo.smp.rows.reduce((sum, row) => sum + row.registered, 0), 576237);
});

test("remaining 07.09 federal sources are synchronized", () => {
  assert.deepEqual([units.tvspDiagnostic.plan, units.tvspDiagnostic.fact, units.tvspDiagnostic.date], [304, 300, "07.09.2026"]);
  assert.deepEqual([units.smpFederal.plan, units.smpFederal.fact, units.smpFederal.date], [68, 68, "07.09.2026"]);
  assert.equal(status.tmkRemd.date, "07.09.2026");
  assert.equal(status.tmkRemd.rows.filter(row => row.fact > 0).length, 39);
  assert.equal(status.elmk.period, "01.01–07.09.2026");
});

test("all current-source datasets carry the expected cut-off", () => {
  const expected = {
    egpu: "07.09.2026", egpu2days: "07.09.2026", birth: "07.09.2026", death: "07.09.2026",
    semd228: "07.09.2026", hospital: "07.09.2026", smp: "28.08.2026",
    tvspStationary: "07.09.2026", tvspAmbulatory: "07.09.2026", tvspLaboratory: "07.09.2026",
    tvspDiagnostic: "07.09.2026", smpFederal: "07.09.2026",
  };
  for (const [metric, date] of Object.entries(expected)) assert.equal(mo[metric].date, date, metric);
  assert.equal(operational.tmkMaxCount.date, "07.09.2026");
  assert.equal(operational.elnMaxCount.date, "07.09.2026");
});
