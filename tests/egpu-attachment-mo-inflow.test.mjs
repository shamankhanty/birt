import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAttachmentMoInflow } from "../lib/egpu-attachment-mo-inflow.js";
import { selectOperationalComparison } from "../lib/operational-comparison.js";
import { filterActiveDatasetMap } from "../lib/mo-reorganization.js";

const read = (name) => JSON.parse(readFileSync(new URL("../" + name, import.meta.url), "utf8"));
const mo = read("app/mo-data.json");
const volume = read("app/egpu-attachment-volume-snapshots.json");
const details = read("app/mo-detail-oids.json");

test("22–27 November per-MO EPGU denominators reconcile exactly to the republic totals", () => {
  for (const metric of ["egpu", "egpu2days"]) {
    const result = buildAttachmentMoInflow(mo[metric], volume);
    assert.ok(result, metric);
    assert.equal(result.organizations, 82);
    assert.equal(result.count, 1125);
    assert.equal(result.previousDate, "22.11.2026");
    assert.equal(result.currentDate, "27.11.2026");
    assert.equal(Object.values(result.byOid).reduce((sum, row) => sum + row.current, 0), 50294);
    assert.equal(Object.values(result.byOid).reduce((sum, row) => sum + row.previous, 0), 49169);
    assert.equal(Object.values(result.byOid).reduce((sum, row) => sum + row.delta, 0), 1125);
    for (const [oid, row] of Object.entries(result.byOid)) {
      assert.equal(row.current, details[metric][oid]?.volume, `${metric}:${oid}`);
      assert.equal(row.previous, volume.previous.byOid[oid]);
    }
  }
});

test("one request stream shared by egpu and egpu2days is not double-counted", () => {
  const result = buildAttachmentMoInflow(mo.egpu, volume);
  assert.deepEqual(result, buildAttachmentMoInflow(mo.egpu2days, volume));
  assert.equal(result.byOid["1.2.643.5.1.13.13.12.2.16.1163"].delta, 90); // GKB 7
  assert.equal(result.byOid["1.2.643.5.1.13.13.12.2.16.1074"].delta, 53); // GP 10
  assert.equal(result.byOid["1.2.643.5.1.13.13.12.2.16.1139"].delta, 25); // Zelenodolsk
  assert.equal(result.byOid["1.2.643.5.1.13.13.12.2.16.1093"].delta, 12); // Elabuga
  assert.equal(result.byOid["1.2.643.5.1.13.13.12.2.16.1123"].delta, 4);
  assert.equal(Object.values(result.byOid).filter(row => row.delta < 0).length, 0);
});

test("stale cut, lost organization, null volume or sum mismatch disables estimates", () => {
  assert.equal(buildAttachmentMoInflow({...mo.egpu,date:"26.11.2026"}, volume), null);
  assert.equal(buildAttachmentMoInflow({...mo.egpu,previousDate:"08.11.2026"}, volume), null);
  assert.equal(buildAttachmentMoInflow({...mo.egpu,denominator:48558}, volume), null);
  assert.equal(buildAttachmentMoInflow({...mo.egpu,previousDenominator:null}, volume), null);
  const absent = structuredClone(volume);
  delete absent.previous.byOid["1.2.643.5.1.13.13.12.2.16.1163"];
  assert.equal(buildAttachmentMoInflow(mo.egpu, absent), null);
  const altered = structuredClone(volume);
  altered.current.byOid["1.2.643.5.1.13.13.12.2.16.1163"] = null;
  assert.equal(buildAttachmentMoInflow(mo.egpu, altered), null);
});

test("both EPGU organization tables include the sortable arrivals column", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const isAttachmentMetric = matrixMetric === "egpu" \|\| matrixMetric === "egpu2days";/u);
  assert.match(page, /buildAttachmentMoInflow\(attachmentSourceDataset, attachmentVolumeSnapshotsRaw\)/u);
  assert.match(page, /moSortKey === "inflow"/u);
  assert.match(page, /Новые заявления/u);
  assert.match(page, /className="attachmentInflowCell"/u);
  assert.match(page, /moInflow\.previous/u);
  assert.match(page, /moInflow\.current/u);
  assert.match(page, /attachment-mo-inflow-note/u);
});


test("latest three-day attachment cuts remain usable despite the five-day general trend rule", () => {
  const historical = read("baseline/archive/before-20261127/attachment-inflow.json");
  const active = filterActiveDatasetMap({egpu:historical.egpu, egpu2days:historical.egpu2days});
  for (const metric of ["egpu", "egpu2days"]) {
    const generalTrend = selectOperationalComparison(active[metric], []);
    assert.equal(buildAttachmentMoInflow(generalTrend, historical.volume), null);
    const incoming = buildAttachmentMoInflow(active[metric], historical.volume);
    assert.equal(incoming.count, 610);
    assert.equal(incoming.organizations, 82);
    assert.equal(incoming.byOid["1.2.643.5.1.13.13.12.2.16.1084"].delta, 2);
    assert.equal(incoming.byOid["1.2.643.5.1.13.13.12.2.16.1092"].delta, 0);
  }
});
