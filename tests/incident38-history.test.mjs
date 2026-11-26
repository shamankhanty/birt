import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (name) => JSON.parse(await readFile(new URL(`../app/${name}`, import.meta.url), "utf8"));
const history = await read("incident38-history.json");

test("архив И38 содержит отдельные срезы по двум выгрузкам и не подменяет пропуски", async () => {
  assert.equal(history.schemaVersion, 1);
  assert.deepEqual(history.snapshots.map(({ scope, reportDate, orgs }) => [scope, reportDate, orgs.length]), [
    ["cities", "10.11.2026", 57],
    ["districts", "12.11.2026", 46],
    ["cities", "19.11.2026", 57],
    ["districts", "19.11.2026", 46],
    ["cities", "20.11.2026", 57],
    ["districts", "20.11.2026", 46],
  ]);
  const expectedTotals = { "cities 10.11.2026": { slots: 257621, norm: 435006.518 }, "districts 12.11.2026": { slots: 234285, norm: 355862.25 }, "cities 19.11.2026": { slots: 270564, norm: 436438.518 }, "districts 19.11.2026": { slots: 238467, norm: 355622.25 }, "cities 20.11.2026": { slots: 271287, norm: 437083.518 }, "districts 20.11.2026": { slots: 239592, norm: 355902.25 } };
  for (const snapshot of history.snapshots) {
    assert.equal(snapshot.orgs.reduce((sum, org) => sum + org.epguSlots, 0), expectedTotals[`${snapshot.scope} ${snapshot.reportDate}`].slots);
    assert.ok(Math.abs(snapshot.orgs.reduce((sum, org) => sum + org.norm, 0) - expectedTotals[`${snapshot.scope} ${snapshot.reportDate}`].norm) < 0.001);
    assert.equal(new Set(snapshot.orgs.map((org) => org.oid)).size, snapshot.orgs.length);
    assert.ok(snapshot.orgs.every((org) => org.norm !== null && org.epguSlots !== null));
    const current = await read(`incident38-${snapshot.scope}.json`);
    assert.equal(current.reportDate, "26.11.2026");
    assert.deepEqual(new Set(snapshot.orgs.map((org) => org.oid)), new Set(current.orgs.map((org) => org.oid)));
  }
});

