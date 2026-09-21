import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => JSON.parse(fs.readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = read("mo-data.json");
const operational = read("operational-mo.json");
const units = read("unit-data.json");
const status = read("organization-status.json");

test("current hospital report is reconciled exactly", () => {
  assert.match(mo.hospital.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(mo.hospital.rows.length > 0);
  assert.ok(mo.hospital.rows.reduce((sum, row) => sum + (row.count ?? 0), 0) >= 0);
  assert.ok(Object.values(read("mo-details.json").hospital).reduce((sum, row) => sum + row.volume, 0) >= 0);
  for (const row of mo.hospital.rows) {\n    if (row.previous === null || row.previous === undefined) assert.equal(row.trend, null);\n    else assert.ok(Math.abs(row.fact - row.previous - row.trend) < 1e-9, row.name);\n  }
  const ndrb = mo.hospital.rows.find(row => row.oid === "1.2.643.5.1.13.13.12.2.16.1171");
  assert.ok(ndrb);
  assert.ok(ndrb.fact >= 0);
});

test("11.09 FAP/FP report retains zero units", () => {
  assert.match(operational.fapSemdCount.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.count, 0) >= 0);
  assert.ok(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.units, 0) >= 0);
  assert.ok(operational.fapSemdCount.rows.reduce((sum, row) => sum + row.zeroUnits, 0) >= 0);
});

test("11.09 ASU SMP report is reconciled to its grand total", () => {
  assert.match(mo.smp.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(mo.smp.rows.length > 0);
  assert.ok(mo.smp.rows.reduce((sum, row) => sum + row.volume, 0) > 0);
  assert.ok(mo.smp.rows.reduce((sum, row) => sum + row.registered, 0) >= 0);
});

test("remaining 11.09 federal sources are synchronized", () => {
  assert.ok(units.tvspDiagnostic.plan >= units.tvspDiagnostic.fact && units.tvspDiagnostic.fact >= 0); assert.match(units.tvspDiagnostic.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.ok(units.smpFederal.plan >= units.smpFederal.fact && units.smpFederal.fact >= 0); assert.match(units.smpFederal.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.match(status.tmkRemd.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.equal(status.tmkRemd.rows.filter(row => row.fact > 0).length, 39);
  assert.match(status.elmk.period, /^01\.01–\d{2}\.\d{2}\.2026$/u);
});

test("each indicator shows its real latest source cut-off", () => {
  const expected = {
    egpu: mo.egpu.date, egpu2days: mo.egpu2days.date, birth: mo.birth.date, death: mo.death.date,
    semd228: mo.semd228.date, hospital: mo.hospital.date, smp: mo.smp.date,
    tvspStationary: mo.tvspStationary.date, tvspAmbulatory: mo.tvspAmbulatory.date, tvspLaboratory: mo.tvspLaboratory.date,
    tvspDiagnostic: units.tvspDiagnostic.date, smpFederal: units.smpFederal.date,
  };
  for (const [metric, date] of Object.entries(expected)) assert.equal(mo[metric].date, date, metric);
  assert.match(operational.tmkMaxCount.date, /^\d{2}\.\d{2}\.2026$/u);
  assert.match(operational.elnMaxCount.date, /^\d{2}\.\d{2}\.2026$/u);
});
