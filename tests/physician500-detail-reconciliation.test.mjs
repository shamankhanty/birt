import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function auditFixture(pythonCase) {
  const code = [
    "import json, sys",
    'sys.path.insert(0, "scripts")',
    "from pipeline.physician500_audit import reconcile_physician500_detail",
    'def make(oid, amount, position="Врач-стоматолог", mo="1.2.643.5.1.13.13.12.2.16.1126"):',
    "    row=[None]*13",
    '    row[0]="Республика Татарстан"; row[1]=mo; row[8]=oid; row[9]=position; row[12]=amount',
    "    return row",
    pythonCase,
  ].join("\n");
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test("Sabinsky 2/5 is reproduced by exact roles and zero-FRMR worker without summing", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","name":"Сабинская ЦРБ","count":2,"volume":5,"fact":40}]}
rows=[
 make("2022.1520156",0,"Врач-стоматолог-терапевт"),
 make("2022.1520156",120,"Врач-стоматолог детский"),
 make("2022.1520156",68,"Врач-стоматолог-хирург"),
 make("2022.181023",709,"Врач-стоматолог-хирург"),
 make("2022.68076",378,"Врач-стоматолог детский"),
 make("2022.68076",525,"Врач-стоматолог-терапевт"),
 make("2022.68076",165,"Врач-стоматолог-терапевт"),
 make("2022.1505979",132,"Врач-стоматолог-терапевт"),
 make("2022.866538",540,"Врач-стоматолог-хирург"),
 make("2023.4380784",0,"Врач-стоматолог"),
 make("2022.5547",569,"Врач-стоматолог"),
 make("2022.142192",0,"Врач-стоматолог-ортопед"),
 make("2022.180153",0,"Врач-стоматолог-ортопед"),
]
result=reconcile_physician500_detail(rows,source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.deepEqual(got.audit.statusSummary, { PASS: 1, WARN: 0, FAIL: 0 });
  assert.equal(got.row.fact, 40);
  assert.equal(got.row.count, 2);
  assert.equal(got.row.volume, 5);
  assert.equal(got.row.detailReconciliation.status, "PASS");
  assert.equal(got.row.detailReconciliation.detailCountNoSum, 2);
  assert.equal(got.row.detailReconciliation.detailVolume, 5);
  assert.equal(got.row.sourceWarning, undefined);
});

test("matching OIDs keep the official fact and do not add warnings", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","count":1,"volume":2,"fact":50}]}
result=reconcile_physician500_detail([make("person1",501),make("person2",100)],source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.deepEqual(got.audit.statusSummary, { PASS: 1, WARN: 0, FAIL: 0 });
  assert.equal(got.row.detailReconciliation.status, "PASS");
  assert.equal(got.row.sourceWarning, undefined);
});

test("missing individual detail is WARN rather than a fabricated zero", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","count":2,"volume":5,"fact":40}]}
result=reconcile_physician500_detail(None,source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.equal(got.audit.unavailable, 1);
  assert.equal(got.row.detailReconciliation.status, "WARN");
  assert.equal(got.row.detailReconciliation.reasonCode, "DETAIL_UNAVAILABLE");
  assert.equal(got.row.detailReconciliation.detailCountNoSum, null);
  assert.equal(got.row.count, 2);
});

test("dentist surgeon and orthopedist are not silently merged into dentist", () => {
  const got = auditFixture(`
mo="1.2.643.5.1.13.13.12.2.16.1126"
source={"doctor500_dentist":[{"oid":mo,"count":0,"volume":0,"fact":0}],
        "doctor500_surgeon":[{"oid":mo,"count":0,"volume":0,"fact":0}]}
result=reconcile_physician500_detail([
 make("surgeon",701,"Врач-стоматолог-хирург"),
 make("orthopedist",800,"Врач-стоматолог-ортопед")
],source)
print(json.dumps({"audit":result,"dentist":source["doctor500_dentist"][0],"surgeon":source["doctor500_surgeon"][0]},ensure_ascii=False))
`);
  assert.equal(got.dentist.detailReconciliation.status, "WARN");
  assert.equal(got.dentist.detailReconciliation.detailCountNoSum, null);
  assert.equal(got.surgeon.detailReconciliation.status, "WARN");
});

test("multiple sub-threshold rows never become an approved 500+ fact", () => {
  const got = auditFixture(`
source={"doctor500_dentist":[{"oid":"1.2.643.5.1.13.13.12.2.16.1126","count":0,"volume":1,"fact":0}]}
result=reconcile_physician500_detail([make("person1",300),make("person1",250)],source)
print(json.dumps({"audit":result,"row":source["doctor500_dentist"][0]},ensure_ascii=False))
`);
  assert.equal(got.row.detailReconciliation.status, "WARN");
  assert.equal(got.row.detailReconciliation.detailCountNoSum, 0);
  assert.equal(got.row.detailReconciliation.detailCountSummed, 1);
  assert.equal(got.row.detailReconciliation.thresholdAmbiguousWorkers, 1);
  assert.equal(got.row.count, 0);
});

test("adapter and report generator keep the audit in the update path", () => {
  const adapter = fs.readFileSync("scripts/pipeline/adapters.py", "utf8");
  const report = fs.readFileSync("scripts/audit_physician500_workbook.py", "utf8");
  assert.match(adapter, /reconcile_physician500_detail\(/u);
  assert.match(adapter, /detail_sheet\.iter_rows\(min_row=8, values_only=True\)/u);
  assert.match(adapter, /x\.get\("sourceWarning"\)/u);
  assert.match(report, /DETAIL_SCOPE_OR_SUM_AMBIGUOUS|detailNumeratorNoSum/u);
  assert.match(report, /sourceSha256/u);
});
