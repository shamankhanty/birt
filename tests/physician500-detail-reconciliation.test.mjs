import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function auditFixture(pythonCase) {
  const code = [
    'import json, sys',
    'sys.path.insert(0, "scripts")',
    'from pipeline.physician500_audit import reconcile_physician500_detail',
    'def make(oid, amount, position="Врач-стоматолог", mo="1.2.643.5.1.13.13.12.2.16.1126"):',
    '    row=[None]*13',
    '    row[0]="Республика Татарстан"; row[1]=mo; row[8]=oid; row[9]=position; row[12]=amount',
    '    return row',
    pythonCase,
  ].join("\n");
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test("500+ detail audit flags Sabinsky 2/5 vs preliminary 4/6 without altering source facts", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","name":"Сабинская ЦРБ","count":2,"volume":5,"fact":40}]}
counts=[("2022.1520156",120),("2022.1520156",68),("2022.181023",709),("2022.68076",378),("2022.68076",525),("2022.1505979",132),("2022.866538",540),("2022.68076",165),("2022.5547",569)]
result=reconcile_physician500_detail([make(i,v) for i,v in counts],source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.deepEqual(got.audit, { compared: 1, warnings: 1, unavailable: 0, skippedDetailRows: 0 });
  assert.equal(got.row.fact, 40);
  assert.equal(got.row.count, 2);
  assert.equal(got.row.volume, 5);
  assert.equal(got.row.detailReconciliation.status, "WARN");
  assert.equal(got.row.detailReconciliation.detailCount, 4);
  assert.equal(got.row.detailReconciliation.detailVolume, 6);
  assert.match(got.row.sourceWarning, /Требуется сверка/u);
});

test("matching OIDs keep the official fact and do not add warnings", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","count":1,"volume":2,"fact":50}]}
result=reconcile_physician500_detail([make("person1",501),make("person2",100)],source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.equal(got.audit.warnings, 0);
  assert.equal(got.row.detailReconciliation.status, "MATCH");
  assert.equal(got.row.sourceWarning, undefined);
});

test("missing individual detail is UNAVAILABLE rather than a zero result", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","count":2,"volume":5,"fact":40}]}
result=reconcile_physician500_detail(None,source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.equal(got.audit.unavailable, 1);
  assert.equal(got.row.detailReconciliation.status, "UNAVAILABLE");
  assert.equal(got.row.detailReconciliation.detailCount, null);
  assert.equal(got.row.count, 2);
});

test("dentist surgeon belongs to dentist, not general surgeon, and review is period-locked", () => {
  const got = auditFixture(`
mo="1.2.643.5.1.13.13.12.2.16.1126"
source={"doctor500_dentist":[{"oid":mo,"count":1,"volume":1,"fact":100}],
        "doctor500_surgeon":[{"oid":mo,"count":0,"volume":0,"fact":0}]}
result=reconcile_physician500_detail([make("doc",701,"Врач-стоматолог-хирург")],source)
print(json.dumps({"audit":result,"dentist":source["doctor500_dentist"][0],"surgeon":source["doctor500_surgeon"][0]},ensure_ascii=False))
`);
  assert.equal(got.dentist.detailReconciliation.status, "MATCH");
  assert.equal(got.surgeon.detailReconciliation.status, "UNAVAILABLE");
  const reviews = JSON.parse(fs.readFileSync("config/physician-500-reviews.json", "utf8"));
  assert.equal(reviews.reviews[0].sourceDate, "19.10.2026");
  assert.equal(reviews.reviews[0].sourceNumerator, 2);
  assert.equal(reviews.reviews[0].detailNumerator, 4);
  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.match(page, /review\.sourceDate === \(physicianWeeklySnapshot\.periods\?\./u);
  assert.match(page, /sourceWarning: \[row\.sourceWarning, review\?\.warning\]/u);
});

test("adapter reconciles both monthly and operational without changing summary", () => {
  const adapter = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
  assert.match(adapter, /reconcile_physician500_detail\(/u);
  assert.match(adapter, /detail_sheet\.iter_rows\(min_row=8, values_only=True\)/u);
  assert.match(adapter, /x\.get\("sourceWarning"\)/u);
  assert.match(adapter, /weekly\.update\(\{"source": source\.name/u);
});
