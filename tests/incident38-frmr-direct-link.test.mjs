import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => JSON.parse(readFileSync(new URL("../app/" + file, import.meta.url), "utf8"));
const cities = read("incident38-cities.json");
const districts = read("incident38-districts.json");
const frmr = read("frmr-all-specialties.json");
const prefix = "1.2.643.5.1.13.13.12.2.16.";

test("И38 → раздел 06: every 19.11.2026 organization resolves to exactly one FRMR MO by OID", () => {
  const frmrIds = frmr.summary.rows.map(row => row[0]);
  assert.equal(new Set(frmrIds).size, frmrIds.length, "duplicates in FRMR MO registry");
  const frmrSet = new Set(frmrIds);
  const organizations = [...cities.orgs, ...districts.orgs];
  assert.equal(organizations.length, 103);
  for (const org of organizations) {
    assert.ok(org.oid.startsWith(prefix), org.name + ": invalid OID prefix");
    const id = org.oid.slice(prefix.length);
    assert.ok(/^\d+$/.test(id), org.name + ": malformed MO OID");
    assert.ok(frmrSet.has(id), org.name + ": not found in section 06 by exact OID");
  }
  const saby = organizations.find(org => org.oid.endsWith(".1126"));
  assert.ok(saby);
  assert.ok(frmrSet.has("1126"));
  assert.equal(frmr.summary.sourceCut, "19.11.2026");
});

test("И38 MO button opens the same MO directly, without redirecting via names", () => {
  const incident = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const frmrUi = readFileSync(new URL("../app/frmr-reconciliation.tsx", import.meta.url), "utf8");
  assert.match(incident, /FRMR_MO_IDS\.has\(frmrMoId\)/);
  assert.match(incident, /Проверить ошибки в ФРМР/);
  assert.match(incident, /onOpenFrmrMo\(selectedOrg\.oid\)/);
  assert.match(page, /setFrmrTargetOid\(oid\)/);
  assert.match(page, /setTab\("frmr"\)/);
  assert.match(page, /<FrmrReconciliation key=\{frmrTargetOid \?\? "overview"\} targetOid=\{frmrTargetOid\}/);
  assert.match(frmrUi, /targetOid\?\.startsWith\(officialPrefix\)/);
  assert.match(frmrUi, /scopedAll\.summary\.rows\.some\(row => row\[0\] === initialMoId\)/);
  assert.match(frmrUi, /matchedInitialMoId \? "organization" : "minister"/);
  assert.match(frmrUi, /useState<string \| null>\(matchedInitialMoId\)/);
  // Manual navigation to 06 continues to begin at the republican overview.
  assert.match(page, /setFrmrTargetOid\(null\); setTab\("frmr"\)/);
  assert.match(page, /if \(id === "frmr"\) setFrmrTargetOid\(null\)/);
});

test("I38 percentage methodology and FRMR source data are untouched", () => {
  const incident = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  assert.match(incident, /const PLAN_PERCENT = 70/);
  assert.match(incident, /const ratio = \(slots: SlotValue, norm: SlotValue\)/);
  assert.match(incident, /Нулевой норматив сам по себе не доказывает ошибку/);
});
