import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { classifyRkbSourceRow, validateRkbBranchCatalog } from "../lib/rkb-branch.js";
import { createMoRegistryRuntime, reportMoName } from "../lib/mo-registry.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const catalog = read("config/rkb-spassk-branch.json");
const registry = read("app/mo-registry.json");
const frmo = read("app/frmo-linkage-data.json");
const runtime = createMoRegistryRuntime(registry);
const rootOid = "1.2.643.5.1.13.13.12.2.16.1094";

test("Spassk identity catalog has 39 unique subunits and 37 buildings, not a separate legal MO", () => {
  const check = validateRkbBranchCatalog(catalog);
  assert.equal(check.valid, true);
  assert.equal(check.subunitCount, 39);
  assert.equal(check.buildingCount, 37);
  assert.equal(catalog.parent.oid, rootOid);
  assert.equal(catalog.parent.currentCode, "6601");
  assert.equal(catalog.branch.historicCode, "4001");
  assert.equal(catalog.policy.doNotRecalculateExistingFacts, true);
  assert.equal(catalog.provenance.sourcePeriod, null);
});

test("a named RKB row never becomes Spassk just because its parent OID is 1094", () => {
  const source = {name: 'ГАУЗ "РКБ МЗ РТ"', oid: rootOid};
  assert.equal(classifyRkbSourceRow(source, catalog).status, "rkb-parent-only");
  assert.equal(classifyRkbSourceRow(source, catalog).branchCode, null);
  assert.equal(runtime.organizationForMetric("semd228", source)?.oid, rootOid);
  assert.equal(reportMoName("semd228", source.name), "РКБ МЗ РТ");
});

test("subunit OID identifies branch for drilldown but does not allow totals or rate recomputation", () => {
  for (const subunit of catalog.subunits) {
    const classified = classifyRkbSourceRow({name:'ГАУЗ "РКБ МЗ РТ"', moOid:rootOid, spOid:subunit.spOid}, catalog);
    assert.equal(classified.status, "spassk-subunit");
    assert.equal(classified.ownerOid, rootOid);
    assert.equal(classified.branchCode, "4001");
    assert.equal(classified.aggregationApproved, false);
  }
});

test("unverified subunits, bare branch name and conflicting MO OIDs cannot be used as fact attribution", () => {
  const unknown = classifyRkbSourceRow({oid:rootOid,spOid:rootOid+".0.999999"},catalog);
  assert.equal(unknown.status,"unverified-rkb-subunit");
  assert.equal(unknown.aggregationApproved,false);
  const onlyName = classifyRkbSourceRow({name:'Филиал РКБ — Спасская ЦРБ'},catalog);
  assert.equal(onlyName.status,"spassk-name-only");
  assert.equal(onlyName.aggregationApproved,false);
  const conflict = classifyRkbSourceRow({name:'Спасская ЦРБ',moOid:"1.2.643.5.1.13.13.12.2.16.1132"},catalog);
  assert.equal(conflict.status,"conflict");
  assert.equal(conflict.ownerOid,null);
  assert.equal(runtime.organizationByMetricAndName("egpu","РКБ"), null);
});

test("current FRMO linkage for code 4001 is inconsistent, so aggregation gate must remain closed", () => {
  const source = frmo.organizations.find((org) => org.code === "4001");
  assert.ok(source);
  assert.equal(source.rows, 71);
  assert.equal(source.issues, 71);
  assert.deepEqual(new Set(source.parentOids), new Set(catalog.frmoAudit.parentOidVariants));
  assert.equal(frmo.cut, "30.10.2026");
});
