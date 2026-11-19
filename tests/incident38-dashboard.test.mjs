import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cities = JSON.parse(fs.readFileSync("app/incident38-cities.json", "utf8"));
const districts = JSON.parse(fs.readFileSync("app/incident38-districts.json", "utf8"));
const expectedCodes = ["11", "13", "25", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "26"];

test("Incident 38 keeps city and district exports as separate dated datasets", () => {
  assert.equal(cities.reportDate, "19.11.2026");
  assert.equal(cities.frmoDate, "19.11.2026");
  assert.equal(cities.orgCount, 57);
  assert.equal(districts.reportDate, "19.11.2026");
  assert.equal(districts.frmoDate, "19.11.2026");
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
