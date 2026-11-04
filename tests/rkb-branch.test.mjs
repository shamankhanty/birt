import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
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

test("both source sheets resolve independently through the runtime without changing legal OIDs", () => {
  for (const [units, expected] of [[catalog.subunits, 'context:spassk-crb'], [catalog.parentSubunits, rootOid]]) {
    for (const unit of units) {
      const row = { name: 'ГАУЗ "РКБ МЗ РТ"', oid: rootOid, spOid: unit.spOid };
      assert.equal(runtime.organizationForMetric('semd228', row)?.oid, expected);
      assert.equal(row.oid, rootOid);
    }
  }
  assert.equal(validateRkbBranchCatalog(catalog).parentBuildingCount, 11);
});

test("approved report aliases require matching report and metric; certificates and general REMD stay RKB", () => {
  for (const rule of catalog.reportAliases.rules) {
    for (const metric of rule.metrics) {
      const row = { name: 'РКБ', oid: rootOid, sourceReport: rule.sourceReport };
      assert.equal(runtime.organizationForMetric(metric, row)?.oid, 'context:spassk-crb');
      assert.equal(runtime.organizationForMetric('birth', row)?.oid, rootOid);
      assert.equal(runtime.organizationForMetric('death', row)?.oid, rootOid);
      assert.equal(runtime.organizationForMetric(metric, {...row, sourceReport: 'general-remd'})?.oid, rootOid);
    }
  }
});

test("conflicting structural identifiers stop attribution and unrelated MO still resolves", () => {
  assert.equal(runtime.organizationForMetric('semd228', {
    name: 'РКБ', oid: rootOid, spOid: catalog.subunits[0].spOid,
    buildingId: catalog.parentSubunits[0].buildingIds[0],
  }), null);
  assert.equal(runtime.organizationForMetric('semd228', {
    name: 'РКБ', oid: rootOid, spOid: catalog.parentSubunits[0].spOid,
    sourceReport: 'gis-preventive-encounters',
  }), null);
  const other = registry.organizations.find(org => org.oid.endsWith('.1153'));
  assert.equal(runtime.organizationForMetric('semd228', {
    name: other.name, oid: other.oid, spOid: other.oid + '.0.123',
  })?.oid, other.oid);
});

test("pipeline preserves source OID and records branch identity separately", () => {
  const source = { name: 'РКБ', oid: rootOid, spOid: catalog.subunits[0].spOid, count: 20 };
  const result = spawnSync(process.execPath, ['scripts/pipeline/resolve-organizations.mjs'], {
    input: JSON.stringify({metric:'semd228', rows:[source], registry}), encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const [row] = JSON.parse(result.stdout);
  assert.equal(row.oid, rootOid);
  assert.equal(row.reportingEntityId, 'context:spassk-crb');
  assert.equal(row.name, 'Спасская ЦРБ');
  assert.equal(row.count, source.count);
});

test("source evidence distinguishes parent REMD from closed GIS cases and encounters", () => {
  const audit = read('docs/rkb-spassk-source-audit-20261104.json');
  assert.equal(audit.structure['Спаск'].subunits,39);
  assert.equal(audit.structure['РКБ'].subunits,98);
  assert.equal(audit.overlappingSubunitOids,0);
  assert.equal(audit.frmo.mismatchedLinks,70);
  assert.equal(audit.preventiveStatus,'branch-numerator-attribution-pending');
  const byScope = Object.fromEntries(audit.preventiveComponents.map(r=>[r.scope,r]));
  assert.equal(byScope['legal-entity-remd'].semd122,7309);
  assert.equal(byScope['closed-gis-cases'].semd122,6592);
  assert.equal(byScope['preventive-encounters'].encounters,8369);
});

test("pipeline rejects unverified aggregation of subunits and parent/branch overlap", () => {
  const code = `import json, sys
from scripts.pipeline.adapters import source_rows
cases=json.load(sys.stdin)
for rows in cases:
    try:
        source_rows(rows, 'semd228')
    except ValueError:
        continue
    raise AssertionError('Unreconciled rows were accepted')
`;
  const cases = [
    [{name:'РКБ',oid:rootOid,spOid:catalog.subunits[0].spOid,count:20}],
    [{name:'Спасская ЦРБ',oid:rootOid,count:20},{name:'РКБ',oid:rootOid,count:100}],
  ];
  const result = spawnSync('python3',['-c',code],{input:JSON.stringify(cases),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
