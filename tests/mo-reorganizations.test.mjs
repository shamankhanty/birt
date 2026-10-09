import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const reorg = JSON.parse(fs.readFileSync("config/mo-reorganizations.json", "utf8"));
const registry = JSON.parse(fs.readFileSync("app/mo-registry.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

test("Almetyevsk reorganization is an auditable pending registry, not an OID rewrite", () => {
  const group = reorg.groups.find((item) => item.id === "almetyevsk-crb-2026-10");
  assert.ok(group);
  assert.equal(group.effectiveDate, "2026-10-01");
  assert.equal(group.status, "verification_pending");
  assert.match(group.document.basis, /№751/u);
  assert.match(group.historicalPolicy, /не переписываются/u);
  const expectedOids = ["1.2.643.5.1.13.13.12.2.16.1107","1.2.643.5.1.13.13.12.2.16.1146","1.2.643.5.1.13.13.12.2.16.1100","1.2.643.5.1.13.13.12.2.16.1057","1.2.643.5.1.13.13.12.2.16.1128"];
  assert.deepEqual(group.predecessors.map((item) => item.oldOid), expectedOids);
  assert.ok(group.predecessors.every((item) => item.successorOid === null));
  assert.ok(group.predecessors.every((item) => item.frmoStatus === "pending" && item.frmrStatus === "pending" && item.sourceStatus === "pending"));
  const registryOids = new Set((registry.organizations ?? registry).map((item) => item.oid));
  for (const oid of expectedOids) assert.ok(registryOids.has(oid), `${oid} remains a separate source OID`);
  assert.match(page, /MoReorganizationRegistry/u);
});
