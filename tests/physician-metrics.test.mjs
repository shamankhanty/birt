import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const data = JSON.parse(fs.readFileSync(new URL("../app/physician-metrics.json", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("physician report covers all expected organizations and specialties", () => {
  assert.equal(data.quality.allMoRows, 125);
  assert.equal(data.quality.allMoOids, 125);
  assert.equal(data.quality.specialtyRows, 726);
  assert.equal(data.quality.specialtyMoOids, 116);
  assert.equal(data.quality.unmatchedOids, 0);
  assert.equal(data.quality.categoryErrors, 0);
  assert.equal(Object.keys(data.datasets).length, 11);
});

test("regional physician totals reproduce the federal workbook", () => {
  assert.deepEqual(data.datasets.doctorsAll.summary, {
    numerator: 9974,
    denominator: 13266,
    fact: 9974 / 13266 * 100,
  });
  assert.deepEqual(data.datasets.doctorsLevel3.summary, {
    numerator: 3527,
    denominator: 4732,
    fact: 3527 / 4732 * 100,
  });
  assert.equal(data.datasets.doctor500_dentist.summary.numerator, 68);
  assert.equal(data.datasets.doctor500_dentist.summary.denominator, 658);
});

test("small specialty denominators are reference-only in hearings", () => {
  for (const [id, dataset] of Object.entries(data.datasets)) {
    if (!id.startsWith("doctor500_")) continue;
    for (const row of dataset.rows) {
      if (row.volume < 3) assert.match(row.sourceWarning, /Справочно/);
      else assert.equal(row.sourceWarning ?? null, null);
    }
  }
  assert.match(source, /!isSmallPhysicianDenominator\(id, row\)/);
});

test("newly heard organizations and alias search are wired", () => {
  for (const oid of [
    "context:spassk-crb",
    "1.2.643.5.1.13.13.12.2.16.1150",
    "1.2.643.5.1.13.13.12.2.16.1169",
    "1.2.643.5.1.13.13.12.2.16.1055",
    "1.2.643.5.1.13.13.12.2.16.1107",
    "1.2.643.5.1.13.13.12.2.16.1115",
  ]) assert.match(source, new RegExp(oid.replaceAll(".", "\\.")));
  assert.match(source, /function moSearchText/);
  assert.match(source, /registry\?\.aliases/);
});
