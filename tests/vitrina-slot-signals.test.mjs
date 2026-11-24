import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVitrinaSlotSignals } from "../lib/vitrina-slot-signals.js";

const base = {
  organizationId: "oid-1", organizationName: "ГАУЗ ГП № 1",
  subdivisionName: "Поликлиника", specialty: "Врач-терапевт",
  exportDate: "24.11.2026", appointmentDate: "09.12.2026"
};
test("appointment duration > 20 minutes is a review signal, exactly 20 is not", () => {
  const r = analyzeVitrinaSlotSignals([
    {...base, slotId:"1", startTime:"10:00", endTime:"10:21"},
    {...base, slotId:"2", durationMinutes:20},
    {...base, slotId:"3", durationMinutes:21.5}
  ], {exportDate:"2026-11-24",appointmentDate:"2026-12-09"});
  assert.equal(r.checkedRows,3);
  assert.deepEqual(r.alerts.map(x=>x.code),["duration-over-limit","duration-over-limit"]);
  assert.equal(r.alerts[0].level,"review");
  assert.equal(r.durationChecked,3);
});
test("unknown duration is never converted into zero", () => {
  const r=analyzeVitrinaSlotSignals([{...base, durationMinutes:null}]);
  assert.equal(r.durationUnavailable,1);
  assert.equal(r.durationChecked,0);
  assert.equal(r.alerts.length,0);
});
test("source and appointment dates are filtered independently", () => {
  const rows=[
    {...base,slotId:"1",durationMinutes:25},
    {...base,slotId:"1",exportDate:"23.11.2026",durationMinutes:30},
    {...base,slotId:"1",appointmentDate:"23.11.2026",durationMinutes:35}
  ];
  const r=analyzeVitrinaSlotSignals(rows,{exportDate:"24.11.2026",appointmentDate:"09.12.2026"});
  assert.equal(r.checkedRows,1);
  assert.equal(r.alerts.length,1);
  assert.equal(r.alerts[0].durationMinutes,25);
});
test("absence of records is no data, not 0", () => {
  const r=analyzeVitrinaSlotSignals([],{exportDate:"24.11.2026"});
  assert.equal(r.sourceStatus,"no-data");
  assert.equal(r.checkedRows,null);
  assert.equal(r.durationChecked,null);
  assert.equal(r.affectedOrganizationCount,null);
});
test("technical organizations are ignored without removing original rows",()=>{
  const rows=[{...base,organizationName:"Тестовое ЛПУ",durationMinutes:25},{...base,organizationName:"Неизвестная МО",durationMinutes:25}];
  assert.equal(analyzeVitrinaSlotSignals(rows).checkedRows,null);
  assert.equal(rows.length,2);
});
test("only repeated slot identifiers within one organization and two dates are flagged",()=>{
  const r=analyzeVitrinaSlotSignals([
    {...base,slotId:"1",durationMinutes:15},
    {...base,slotId:"1",durationMinutes:15},
    {...base,slotId:"1",organizationId:"oid-2",durationMinutes:15},
    {...base,durationMinutes:15},
    {...base,durationMinutes:15},
  ]);
  assert.deepEqual(r.alerts.map(x=>x.code),["duplicate-slot-id"]);
});

test("blank duration is unknown and source indexes survive date filters", () => {
  const r=analyzeVitrinaSlotSignals([
    {...base,exportDate:"23.11.2026",durationMinutes:25},
    {...base,exportDate:"24.11.2026",durationMinutes:" "},
    {...base,exportDate:"24.11.2026",durationMinutes:21}
  ], {exportDate:"24.11.2026"});
  assert.equal(r.durationUnavailable,1);
  assert.equal(r.durationChecked,1);
  assert.equal(r.alerts[0].sourceRowIndex,2);
});
