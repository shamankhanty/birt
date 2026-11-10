import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createDoctorsAllCumulativeDatasets } from "../lib/physician-doctors-all-cumulative.js";
import { buildOctoberRating } from "../lib/october-rating.js";

const load = path => JSON.parse(fs.readFileSync(path, "utf8"));
const source = load("app/physician-doctors-all-cumulative-2026-10.json");
const month = load("app/monthly-mo.json");
const physician = load("app/physician-metrics.json");
const snapshots = createDoctorsAllCumulativeDatasets(source, month.doctorsAll, physician.datasets.doctorsAll);
const clinicOid = "1.2.643.5.1.13.13.12.2.16.1125";

test("ten audited BI files create one cumulative source without physician identities", () => {
  assert.equal(source.period, "01.01–31.10.2026");
  assert.equal(source.audit.sources.length, 10);
  assert.equal(source.audit.detailRows, 205590);
  assert.equal(source.audit.missingPhysicianOids, 0);
  assert.equal(source.rows.length, 126);
  assert.equal(new Set(source.rows.map(r => String(r[0]))).size, 126);
  assert.equal(source.rows.filter(r => r[3] !== null).length, 124);
  assert.equal(source.rows.filter(r => r[3] === null).length, 2);
  assert.deepEqual(source.rows.filter(r => r[3] === null).map(r => String(r[0])).sort(), ["1057","1128"]);
  assert.ok(source.rows.every(r => r.length === 5), "only per-MO aggregates stored");
});

test("cumulative doctor-all data have exact monthly FRMR denominators and no repeated signers", () => {
  assert.deepEqual(snapshots.physician.summary, {numerator:12010,denominator:13691,fact:12010/13691*100});
  assert.deepEqual(snapshots.monthly.regional.previous, {numerator:11637,denominator:13542});
  assert.deepEqual(snapshots.monthly.regional.current, {numerator:12010,denominator:13691});
  assert.equal(snapshots.physician.periodKind, "cumulative");
  assert.equal(snapshots.monthly.periodKind, "cumulative");
  assert.equal(snapshots.physician.period, "01.01–31.10.2026");
  assert.ok(snapshots.physician.rows.every(r => r.fact === null || (r.fact>=0 && r.fact<=100)));
  assert.ok(snapshots.physician.rows.every(r => r.count === null || r.count <= r.volume));
  const clinic = snapshots.physician.rows.find(r=>r.oid===clinicOid);
  assert.deepEqual([clinic.count,clinic.volume,clinic.fact], [165,181,165/181*100]);
  assert.ok(Math.abs(clinic.previous-152/178*100)<1e-9);
  assert.equal(month.doctorsAll.rows.find(r=>r.oid===clinicOid).julyQuantity, "144 / 181");
  assert.equal(physician.datasets.doctorsAll.rows.find(r=>r.oid===clinicOid).count,144);
  assert.equal(snapshots.monthly.rows.find(r=>r.oid===clinicOid).julyQuantity,"165 / 181");
});

test("no October FRMR source never becomes zero; still has September for historical comparison",()=>{
  for (const suffix of ["1057","1128"]) {
    const oid="1.2.643.5.1.13.13.12.2.16."+suffix;
    const current=snapshots.physician.rows.find(r=>r.oid===oid);
    const monthly=snapshots.monthly.rows.find(r=>r.oid===oid);
    assert.deepEqual([current.fact,current.count,current.volume,current.trend],[null,null,null,null]);
    assert.equal(monthly.julyQuantity,null);
    assert.equal(monthly.july,null);
    assert.ok(monthly.juneQuantity!==null);
    assert.equal(monthly.sourceStatus,"no_source_row");
  }
});

test("October rating scores the corrected cumulative indicator; September archive remains untouched", () => {
  const september=load("app/rating/september-v2-inputs.json");
  const policy=load("config/september-rating-v2.json");
  const october=load("app/monthly-2026-10.json");
  const base={...month,...october};
  const prior=buildOctoberRating(september,base,policy);
  const updated=buildOctoberRating(september,{...base,doctorsAll:snapshots.monthly},policy);
  assert.equal(prior.length,updated.length);
  const oldClinic=prior.find(r=>r.key===clinicOid);
  const newClinic=updated.find(r=>r.key===clinicOid);
  const oldDoctor=oldClinic.metrics.find(m=>m.id==="doctorsAll");
  const newDoctor=newClinic.metrics.find(m=>m.id==="doctorsAll");
  assert.equal(oldDoctor.status,"reference_only");
  assert.deepEqual([newDoctor.status,newDoctor.numerator,newDoctor.denominator,newDoctor.periodKind,newDoctor.period],[
    "available",165,181,"cumulative","01.01–31.10.2026",
  ]);
  assert.ok(Math.abs(newDoctor.fact-165/181*100)<1e-8);
  assert.ok(updated.some(r=>r.metrics.some(m=>m.id==="doctorsAll" && m.status==="available")));
  for(const row of updated) {
    const old=prior.find(r=>r.key===row.key);
    assert.deepEqual(row.metrics.filter(m=>m.id.startsWith("doctor500_")),old.metrics.filter(m=>m.id.startsWith("doctor500_")),"500+ changes forbidden: "+row.key);
    assert.deepEqual(row.metrics.find(m=>m.id==="doctorsLevel3"),old.metrics.find(m=>m.id==="doctorsLevel3"),"III level changes forbidden: "+row.key);
  }
  const sepClinic=september.organizations.find(r=>r.key===clinicOid).metrics.find(m=>m.id==="doctorsAll");
  assert.deepEqual([sepClinic.numerator,sepClinic.denominator,sepClinic.period],[125,178,"01.09–30.09.2026"]);
});

test("strict validation rejects data drift, duplicated MO and falsified components", () => {
  const custom=rows=>({...source,rows});
  const rows=source.rows.map(r=>[...r]);
  const cl=rows.find(r=>String(r[0])==="1125");
  cl[3]=183;
  assert.throws(()=>createDoctorsAllCumulativeDatasets(custom(rows),month.doctorsAll,physician.datasets.doctorsAll),/Invalid cumulative doctorsAll components|checksum/i);
  const duplicate=source.rows.map(r=>[...r]);duplicate[1][0]=duplicate[0][0];
  assert.throws(()=>createDoctorsAllCumulativeDatasets(custom(duplicate),month.doctorsAll,physician.datasets.doctorsAll),/duplicate MO/i);
});

test("UI uses the cumulative source consistently, never passes a monthly November slice as cumulative", () => {
  const page=fs.readFileSync("app/page.tsx","utf8");
  const rating=fs.readFileSync("app/september-rating.tsx","utf8");
  assert.match(page,/doctorsAllCumulativeRaw/u);
  assert.match(page,/doctorsAll: doctorsAllCumulative\.physician/u);
  assert.match(page,/doctorsAll: doctorsAllCumulative\.monthly/u);
  assert.match(page,/matrixMetric !== "doctorsAll" &&/u);
  assert.match(page,/const liveIndicators = calculationRuntime\.indicators as Indicator\[\]/u);
  assert.doesNotMatch(page,/накопительный факт не представлен/u);
  assert.match(rating,/doctorsAll:cumulativeDoctorsAll\.monthly/u);
  assert.match(rating,/уникальные OID подписантов/u);
});
