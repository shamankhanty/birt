import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cities = JSON.parse(fs.readFileSync("app/incident38-cities.json", "utf8"));
const districts = JSON.parse(fs.readFileSync("app/incident38-districts.json", "utf8"));
const expectedCodes = ["11", "13", "25", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "26"];

test("Incident 38 keeps city and district exports as separate dated datasets", () => {
  assert.equal(cities.reportDate, "26.11.2026");
  assert.equal(cities.frmoDate, "26.11.2026");
  assert.equal(cities.orgCount, 57);
  assert.equal(districts.reportDate, "26.11.2026");
  assert.equal(districts.frmoDate, "26.11.2026");
  assert.equal(districts.orgCount, 46);
  assert.equal(cities.reportDate, districts.reportDate);
});

test("Incident 38 organization and specialty rows are complete and unique", () => {
  for (const data of [cities, districts]) {
    assert.deepEqual(data.specialties.map((item) => item.code), expectedCodes);
    assert.equal(data.orgs.length, data.orgCount);
    assert.equal(new Set(data.orgs.map((org) => org.oid)).size, data.orgCount);
    for (const org of data.orgs) {
      assert.ok(org.oid.startsWith("1.2.643."));
      assert.equal(org.specialties.length, 14);
      assert.deepEqual(org.specialties.map((item) => item.code), expectedCodes);
      for (const item of org.specialties) {
        for (const field of ["norm", "slots", "epguNorm", "epguSlots"]) {
          assert.equal(typeof item[field], "number", `${org.oid} ${item.code} ${field}`);
          assert.ok(item[field] >= 0);
        }
      }
    }
  }
  const cityOids = new Set(cities.orgs.map((org) => org.oid));
  assert.equal(districts.orgs.some((org) => cityOids.has(org.oid)), false);
});


test("Incident 38 specialty columns match source summary controls", () => {
  const controls = [
    [cities, { "11": [146188, 127183, 93978, 97236], "16": [112910, 112537, 72585, 83065], "26": [5160, 5432, 3483, 3751] }],
    [districts, { "11": [95424, 101235, 61344, 65803], "16": [95270, 95719, 61245, 67677], "26": [3038, 2679, 2050.65, 1508] }],
  ];
  for (const [dataset, expected] of controls) {
    for (const [code, totals] of Object.entries(expected)) {
      ["norm", "slots", "epguNorm", "epguSlots"].forEach((field, index) => {
        const actual = dataset.orgs.reduce((sum, org) => sum + org.specialties.find((item) => item.code === code)[field], 0);
        assert.ok(Math.abs(actual - totals[index]) < 0.02, dataset.source + ": " + code + " " + field);
      });
    }
  }
});

test("Incident 38 official totals reconcile and exclude slots with zero specialty norm", () => {
  const controls = [
    [cities, [440180.018, 370737, 277930.011, 271494]],
    [districts, [357902.25, 358853, 225906.9, 238751]],
  ];
  for (const [dataset, expected] of controls) {
    for (const [index, field] of ["norm", "slots", "epguNorm", "epguSlots"].entries()) {
      assert.ok(Math.abs(dataset.orgs.reduce((sum, org) => sum + org.totals[field], 0) - expected[index]) < 0.02);
    }
    for (const org of dataset.orgs) {
      const eligible = org.specialties.filter((row) => row.norm > 0);
      assert.equal(org.totals.epguSlots, eligible.reduce((sum, row) => sum + row.epguSlots, 0), org.name);
      assert.equal(org.totals.norm, org.specialties.reduce((sum, row) => sum + row.norm, 0), org.name);
      if (org.totals.norm > 0) assert.ok(Math.abs(org.totals.sourcePercent - org.totals.epguSlots / org.totals.norm * 100) <= 0.051, org.name);
      else assert.equal(org.totals.sourcePercent, null, org.name);
    }
  }
});

test("adult Naberezhnye Chelny organizations have no pediatric specialty values in the source", () => {
  for (const suffix of [".1116", ".1208", ".1085"]) {
    const org = cities.orgs.find((item) => item.oid.endsWith(suffix));
    assert.ok(org, suffix);
    for (const code of ["16", "26"]) {
      const specialty = org.specialties.find((item) => item.code === code);
      assert.deepEqual([specialty.norm, specialty.slots, specialty.epguNorm, specialty.epguSlots], [0, 0, 0, 0], org.name + ": " + code);
    }
  }
});
