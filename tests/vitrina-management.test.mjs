import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const view=readFileSync("app/vitrina-dashboard.tsx","utf8");
const incident=readFileSync("app/incident38-dashboard.tsx","utf8");
test("Vitrina opens management overview, retains all workflows and one ownership control",()=>{
  assert.match(view,/useState<ManagementTab>\("Сводка МЗ"\)/);
  for(const name of ["Сводка МЗ","Рейтинг МО","Специальности","Контроль ошибок","Сопоставление с И-38","Динамика","Инструкция МО","Исключения"]) assert.ok(view.includes(name),name);
  assert.match(view,/VitrinaPresence includePrivate=\{includePrivate\}/);
  assert.match(view,/Готовность перехода не оценена/);
  assert.match(view,/5 МО с наибольшим приростом/);
  assert.match(view,/5 МО с наибольшим снижением/);
});
test("I-38 context uses existing metrics and prevents false comparison",()=>{
  assert.match(incident,/export function getVitrinaIncident38/);
  assert.match(incident,/dates\.length === 1 && horizons\.length === 1 && unique/);
  assert.match(incident,/metrics\(orgs\.flatMap/);
  assert.match(view,/Не является выгрузкой слотов Витрины/);
  assert.match(view,/расхождение не рассчитывается/);
});
