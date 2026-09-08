import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readJson = async name => JSON.parse(await readFile(new URL(`../app/${name}`, import.meta.url), "utf8"));
const mo = await readJson("mo-data.json");
const oidDetails = await readJson("mo-detail-oids.json");

test("ДГКБ №7 has source quantities for the EPGU final-status indicator", () => {
  const row = mo.egpu.rows.find(item => item.oid === "1.2.643.5.1.13.13.12.2.16.1123");
  assert.ok(row);
  const detail = oidDetails.egpu[row.oid];
  assert.equal(row.count, detail.registered);
  assert.ok(Math.abs(row.fact - detail.registered / detail.volume * 100) < 1e-10);
  assert.deepEqual(detail, { registered: 126, volume: 181 });
});

test("OID detail links reconcile every current ratio row that supplies an OID", () => {
  for (const [metric, dataset] of Object.entries(mo)) {
    if (dataset.mode === "count" || dataset.mode === "presence") continue;
    for (const row of dataset.rows) {
      if (!row.oid || !oidDetails[metric]?.[row.oid]) continue;
      const detail = oidDetails[metric][row.oid];
      assert.ok(Math.abs(row.fact - detail.registered / detail.volume * 100) < 0.015, `${metric}: ${row.name}`);
    }
  }
});
