import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {matchVitrinaOrganizations,summarizeVitrinaIssues,scheduleIdentity} from "../lib/vitrina-management.js";
import {findVitrinaQualityIssues} from "../lib/vitrina-quality.js";
const view=readFileSync("app/vitrina-dashboard.tsx","utf8");
const incident=readFileSync("app/incident38-dashboard.tsx","utf8");
test("Vitrina opens two workspaces and routes a selected MO to drill-down",()=>{
  assert.match(view,/useState<"ministry"\|"organization">\("ministry"\)/);
  assert.match(view,/setSelected\(id\);setMode\("organization"\)/);
  assert.match(view,/Минздрав РТ/);
  assert.match(view,/Медицинская организация/);
  assert.match(view,/Готовность перехода с ФЭР не оценена/);
  assert.match(view,/5 МО с наибольшим приростом/);
  assert.match(view,/5 МО с наибольшим снижением/);
  assert.match(view,/Инструкция МО и методика/);
});
test("I-38 context uses existing metrics, separate dates, and unknowns",()=>{
  assert.match(incident,/dates\.length === 1 && horizons\.length === 1 && unique/);
  assert.match(incident,/metrics\(orgs\.flatMap/);
  assert.match(view,/Свободные слоты \/ >20 мин/);
  assert.match(view,/value="— \/ —"/);
  assert.match(view,/столбец J/);
  assert.match(view,/OID Витрины отсутствует/);
});
test("Organization association requires exact normalized name and locality, refuses ambiguity",()=>{
  const row={id:"v",name:'ГАУЗ "Городская поликлиника № 10" г.Казани',now:1,rows:[{address:"г. Казань, ул. Ленина"}]};
  const kazan={oid:"k",name:'ГАУЗ "ГП №10"',city:"Казань"};
  const chelny={oid:"c",name:'ГАУЗ "ГП №10"',city:"Набережные Челны"};
  assert.deepEqual(matchVitrinaOrganizations([row],[kazan,chelny]),[{id:"v",oid:"k"}]);
  assert.equal(matchVitrinaOrganizations([row],[chelny])[0].oid,null);
  assert.equal(matchVitrinaOrganizations([row,{...row,id:"v2"}],[kazan])[0].oid,null);
  assert.equal(matchVitrinaOrganizations([{...row,now:0}],[kazan])[0].oid,null);
});
test("Grouping of observed causes preserves absence and distinguishes punctuation",()=>{
  const rows=[{name:"Поликлиника",address:", Казань"},{name:"Кабинет 2",address:""}];
  const issues=findVitrinaQualityIssues({id:"v",name:"ГАУЗ",now:2,rows});
  assert.deepEqual(summarizeVitrinaIssues(rows,issues),{leadingComma:1,names:1,empty:1,other:0});
  assert.equal(scheduleIdentity('ГАУЗ "РСП"'),scheduleIdentity("ГАУЗ РСП"));
});
