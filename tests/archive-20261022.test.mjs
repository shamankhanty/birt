import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const mo = read("app/mo-data.json");
const operational = read("app/operational-mo.json");
const status = read("app/organization-status.json");
const preventive = read("app/preventive-semd-audit.json");
const units = read("app/unit-data.json");
const weeklyErrors = read("app/error-categories.json");
const cumulativeErrors = read("app/error-cumulative.json");
const physicians = read("app/physician-weekly-snapshot.json");
const monthly = read("app/monthly-mo.json");
const maxViews = read("app/max-period-views.json");
const semd = read("app/semd-summary.json");
const evidence = read("docs/update-20261022-evidence.json");

test("22 October archive is fully inventoried and missing EPL is retained", () => {
  assert.equal(Object.keys(evidence.sourceFiles).length, 22);
  assert.deepEqual(evidence.retained, [{
    metric: "electronicWaybill",
    reason: "Источник отсутствует в архиве; сохранен предыдущий подтвержденный срез.",
  }]);
  assert.equal(evidence.statistics.preparedIndicators, 30);
  assert.deepEqual(evidence.unchanged, ["egpu", "egpu2days"]);
});

test("core cumulative numerators and denominators match primary sources", () => {
  assert.deepEqual([mo.hospital.date, mo.hospital.numerator, mo.hospital.denominator], ["22.10.2026", 695665, 773909]);
  assert.deepEqual([mo.ambulatoryCase.date, mo.ambulatoryCase.numerator, mo.ambulatoryCase.denominator], ["20.10.2026", 13870920, 15188445]);
  assert.deepEqual([preventive.summary.numerator, preventive.summary.denominator], [2045914, 2338290]);
  assert.deepEqual([mo.birth.numerator, mo.birth.denominator], [25980, 26004]);
  assert.deepEqual([mo.death.numerator, mo.death.denominator], [33050, 33310]);
  assert.deepEqual([mo.smp.numerator, mo.smp.denominator], [716569, 759847]);
});

test("TVSP and presence indicators preserve their own denominators", () => {
  assert.deepEqual([units.tvspAmbulatory.plan, units.tvspAmbulatory.fact], [458, 458]);
  assert.deepEqual([units.tvspStationary.plan, units.tvspStationary.fact], [274, 271]);
  assert.deepEqual([units.tvspLaboratory.plan, units.tvspLaboratory.fact], [126, 126]);
  assert.deepEqual([units.tvspDiagnostic.plan, units.tvspDiagnostic.fact], [304, 301]);
  assert.deepEqual([units.smpFederal.plan, units.smpFederal.fact], [68, 68]);
  assert.deepEqual([status.tmkRemd.numerator, status.tmkRemd.denominator], [40, 40]);
  assert.deepEqual([status.elmk.numerator, status.elmk.denominator], [73, 73]);
});

test("duplicate short-input rows with the same OID are aggregated once", () => {
  for (const metric of ["shortInput", "shortInputAmb", "shortInputHosp"]) {
    const oids = operational[metric].rows.map((row) => row.oid).filter(Boolean);
    assert.equal(new Set(oids).size, oids.length, metric);
  }
  assert.equal(operational.shortInput.rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.15115").fact, 1702);
  assert.equal(operational.shortInput.rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.9252").fact, 0);
});

test("REMD error periods remain independent", () => {
  assert.deepEqual([weeklyErrors.period, weeklyErrors.total], ["15.10.2026–22.10.2026", 42658]);
  assert.deepEqual([cumulativeErrors.period, cumulativeErrors.total], ["01.01.2026–22.10.2026", 15666840]);
  assert.ok(cumulativeErrors.organizationBreakdown.organizationCount > 0);
  assert.equal(cumulativeErrors.organizationBreakdown.totalErrors, cumulativeErrors.total);
});

test("partial October physician source stays operational and September remains monthly", () => {
  assert.equal(physicians.date, "21.10.2026");
  assert.deepEqual([physicians.summary.doctorsAll.numerator, physicians.summary.doctorsAll.denominator], [10635, 13671]);
  assert.equal(monthly.doctorsAll.currentLabel, "Сентябрь 2026");
  assert.equal(monthly.doctor500_dentist.currentLabel, "Сентябрь 2026");
});

test("MAX cumulative and October views use their separate source periods", () => {
  assert.deepEqual([maxViews.cumulative.date, maxViews.cumulative.metrics.tmk.sourceTotal, maxViews.cumulative.metrics.eln.sourceTotal], ["22.10.2026", 68049, 51879]);
  assert.deepEqual([maxViews.operational.date, maxViews.operational.metrics.tmk.sourceTotal, maxViews.operational.metrics.eln.sourceTotal], ["22.10.2026", 10330, 8653]);
});

test("REMD summary reconciles and uses the new cumulative cut", () => {
  assert.equal(semd.period, "01.01.2026–22.10.2026");
  assert.equal(semd.total, 80597687);
  assert.equal(semd.registeredTypes, 97);
  assert.equal(semd.items.reduce((sum, item) => sum + item.count, 0), semd.total);
});
