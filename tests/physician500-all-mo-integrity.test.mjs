import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

// Aggregate-integrity gate. Independent doctor-OID reconciliation against the
// primary XLSX is tracked in https://github.com/shamankhanty/birt/issues/96.
// Never infer individual clinicians or replace an approved fact from these JSONs.
const operational = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const monthly = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));

const specialties = [
  "doctor500_obgyn",
  "doctor500_gp",
  "doctor500_cardiologist",
  "doctor500_oncologist",
  "doctor500_ophthalmologist",
  "doctor500_pediatrician",
  "doctor500_dentist",
  "doctor500_therapist",
  "doctor500_surgeon",
];
const allIndicators = ["doctorsAll", "doctorsLevel3", ...specialties];

function inspectSlice(label, entries, summary, { allowNoSource = false } = {}) {
  let checkedOrganizations = 0;
  for (const id of allIndicators) {
    const rows = entries[id];
    const total = summary[id];
    assert.ok(Array.isArray(rows), label + ": missing dataset " + id);
    assert.ok(total, label + ": missing regional summary " + id);
    const used = new Set();
    let numerator = 0;
    let denominator = 0;
    for (const [i, row] of rows.entries()) {
      const where = label + "/" + id + "/row " + (i + 1);
      assert.equal(typeof row.oid, "string", where + ": OID missing");
      assert.ok(row.oid.length > 0, where + ": empty OID");
      assert.ok(!used.has(row.oid), where + ": duplicate MO OID " + row.oid);
      used.add(row.oid);
      assert.ok(typeof row.name === "string" && row.name.trim(), where + ": MO name missing");

      if (allowNoSource && row.sourceStatus === "no_source_row") {
        // No primary source row is unknown, never a fabricated zero.
        assert.equal(row.count, null, where + ": missing numerator changed to zero");
        assert.equal(row.fact, null, where + ": missing fact changed to zero");
        assert.ok(row.volume == null, where + ": missing denominator changed to zero");
        continue;
      }
      for (const field of ["count", "volume"]) {
        assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0,
          where + ": invalid " + field);
      }
      assert.ok(row.count <= row.volume, where + ": numerator exceeds denominator");
      assert.ok(typeof row.fact === "number" && Number.isFinite(row.fact),
        where + ": fact not numeric");
      const expected = row.volume > 0 ? row.count / row.volume * 100 : 0;
      assert.ok(Math.abs(row.fact - expected) < 0.001,
        where + ": fact differs from numerator / denominator");
      numerator += row.count;
      denominator += row.volume;
      checkedOrganizations += 1;
    }
    assert.equal(numerator, total.numerator, label + "/" + id + ": regional numerator");
    assert.equal(denominator, total.denominator, label + "/" + id + ": regional denominator");
    assert.ok(denominator > 0, label + "/" + id + ": regional denominator is zero");
    assert.ok(Math.abs(total.fact - numerator / denominator * 100) < 0.001,
      label + "/" + id + ": regional percentage");
  }
  assert.ok(checkedOrganizations > 0, label + ": nothing checked");
}

test("all MO × all 500+ specialties: current operational aggregation reconciles", () => {
  assert.match(operational.period, /2026/u);
  inspectSlice("operational/current", operational.datasets, operational.summary);
});

test("all MO × all 500+ specialties: prior operational snapshot reconciles", () => {
  assert.ok(operational.previousPeriods && typeof operational.previousPeriods === "object");
  inspectSlice("operational/previous", operational.previousDatasets, operational.previousSummary);
});

test("all MO × all 500+ specialties: last full-month aggregation reconciles", () => {
  assert.match(monthly.period, /2026/u);
  const rows = Object.fromEntries(allIndicators.map(id => [id, monthly.datasets[id]?.rows]));
  const totals = Object.fromEntries(allIndicators.map(id => [id, monthly.datasets[id]?.summary]));
  inspectSlice("full-month", rows, totals, { allowNoSource: true });
});

test("all nine 500+ indicators have traceable operational source periods", () => {
  for (const id of specialties) {
    const current = operational.periods?.[id];
    const previous = operational.previousPeriods?.[id];
    assert.ok(current?.source && current?.date && current?.period,
      id + ": missing current source metadata");
    assert.ok(previous?.source && previous?.date && previous?.period,
      id + ": missing previous source metadata");
    assert.match(current.period, /^01\.\d{2}\.2026/u,
      id + ": unexpected current period start");
    assert.ok(monthly.datasets[id]?.rows?.length > 0,
      id + ": missing full-month data");
  }
});
