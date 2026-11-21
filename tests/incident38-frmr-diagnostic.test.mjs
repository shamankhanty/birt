import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFrmrSpecialtyIssues, getFrmoOrganizationFindings, I38_SPECIALTY_ROLES } from "../lib/incident38-frmr-diagnostic.js";

const read = file => JSON.parse(readFileSync(new URL("../app/" + file, import.meta.url), "utf8"));
const cities = read("incident38-cities.json");
const districts = read("incident38-districts.json");
const frmr = read("frmr-all-specialties.json");
const frmo = read("frmo-linkage-data.json");
const orgs = [...cities.orgs, ...districts.orgs];
const get = suffix => orgs.find(org => org.oid.endsWith("." + suffix));

test("И38: all 14 specialty codes have role lookups, every mapped role exists in FRMR source", () => {
  const codes = new Set(cities.specialties.map(row => row.code));
  assert.deepEqual(new Set(Object.keys(I38_SPECIALTY_ROLES)), codes);
  const roles = new Set(frmr.departments.roles);
  for (const [code, names] of Object.entries(I38_SPECIALTY_ROLES)) {
    assert.ok(names.length > 0, code);
    for (const role of names) assert.ok(roles.has(role), code + ": " + role);
  }
});

test("И38: show relevant problematic FRMR role records only for exact MO OID and exact specialty", () => {
  const agryz = get("1088");
  assert.ok(agryz);
  const childPsych = getFrmrSpecialtyIssues(agryz.oid, "17", frmr.summary.rows);
  assert.equal(childPsych.matched, true);
  assert.ok(childPsych.count > 0);
  assert.ok(childPsych.roles.every(({ name }) => I38_SPECIALTY_ROLES["17"].includes(name)));
  const noSpecialist = getFrmrSpecialtyIssues(agryz.oid, "26", frmr.summary.rows);
  assert.equal(noSpecialist.matched, true);
  assert.equal(noSpecialist.count, 0); // Zero issue records != no physician.
  const noMatch = getFrmrSpecialtyIssues("1.2.643.5.1.13.13.12.2.16.999999999", "17", frmr.summary.rows);
  assert.deepEqual(noMatch, { matched: false, count: null, roles: [] });
});

test("И38: FRMO issues are only organization-level findings, never specialty-level proof", () => {
  const agryz = get("1088");
  const findings = getFrmoOrganizationFindings(agryz.oid, frmo.organizations);
  assert.deepEqual(findings, { matched: true, ambiguous: false, issues: 25, rows: 29 });
  assert.deepEqual(getFrmoOrganizationFindings("unknown", frmo.organizations), { matched: false, ambiguous: false, issues: null, rows: null });
  assert.deepEqual(getFrmoOrganizationFindings(agryz.oid, [{ parentOids: [agryz.oid] }, { parentOids: [agryz.oid] }]), { matched: false, ambiguous: true, issues: null, rows: null });
});

test("И38 UI: diagnostic flags only for norm > 0 and EPGU slots = 0, no false staff verification claims", () => {
  const ui = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  assert.match(ui, /row\.norm !== null && row\.norm > 0 && row\.epguSlots === 0/);
  assert.match(ui, /getFrmrSpecialtyIssues\(selectedOrg!\.oid, row\.code, frmrRaw\.summary\.rows\)/);
  assert.match(ui, /getFrmoOrganizationFindings\(selectedOrg\.oid, frmoLinkageRaw\.organizations\)/);
  assert.match(ui, /выгрузки не содержат полного списка врачей/);
  assert.match(ui, /Проверить ошибки в ФРМР/);
});
