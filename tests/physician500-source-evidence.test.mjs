import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const evidence = JSON.parse(fs.readFileSync("docs/physician500-source-audit-20261019.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const specialties = [
  "doctor500_obgyn", "doctor500_gp", "doctor500_cardiologist",
  "doctor500_oncologist", "doctor500_ophthalmologist",
  "doctor500_pediatrician", "doctor500_dentist",
  "doctor500_therapist", "doctor500_surgeon"
];

function fnv1a32(lines) {
  let hash = 2166136261;
  for (const char of lines.sort().join("\n")) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}

test("source Excel audit of 2026-10-19 covers every medical organization and specialty", () => {
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(evidence.checks.medicalOrganizations, evidence.checks.medicalOrganizationsReconciled);
  assert.equal(evidence.checks.specialtyRows, evidence.checks.specialtyCategoryRowsValid);
  assert.equal(evidence.checks.dashboardSpecialtyRowsCompared, evidence.checks.dashboardSpecialtyRowsIdentical);
  assert.equal(evidence.checks.regionalSpecialtySummariesReconciled, specialties.length);
  assert.equal(evidence.qualification.aggregatedData, "PASS");
  assert.equal(evidence.qualification.organizationDetailReconciliation, "PASS");
  assert.equal(evidence.qualification.independentSpecialtyStaffClassification, "UNVERIFIED");
});

test("current 500+ source snapshot matches audited Excel on the matching reporting cut", (t) => {
  if (snapshot.date !== evidence.githubSnapshot.date) {
    t.skip("Historical XLSX evidence is tied to the 2026-10-19 cut, not the current release.");
    return;
  }
  const rows = [];
  for (const metric of specialties) {
    for (const item of snapshot.datasets[metric]) {
      rows.push(`${metric}|${item.oid}|${item.count}|${item.volume}`);
    }
  }
  assert.equal(rows.length, evidence.githubSnapshot.sourceMatchRows);
  assert.equal(fnv1a32(rows), evidence.githubSnapshot.normalizedRowsFNV1a32);
  const sabin = snapshot.datasets.doctor500_dentist.find(
    (row) => row.oid === evidence.sabinDental.moOid
  );
  assert.ok(sabin, "Sabinskaya CRB dental row not found");
  assert.equal(sabin.count, evidence.sabinDental.sourceNumerator);
  assert.equal(sabin.volume, evidence.sabinDental.sourceDenominator);
  assert.equal(sabin.fact, evidence.sabinDental.sourcePercent);
});
