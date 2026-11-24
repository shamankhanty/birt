import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {findVitrinaQualityIssues} from "../lib/vitrina-quality.js";

test("quality dashboard shows a risk signal before the untouched organization name",()=>{
  const quality=readFileSync("app/vitrina-quality-dashboard.tsx","utf8");
  const presence=readFileSync("app/vitrina-dashboard.tsx","utf8");
  assert.match(quality, /<OrganizationSignal issues=\{org\.issues\}\/>\s*<span>\{org\.name\}<\/span>/);
  assert.match(quality, /<OrganizationSignal issues=\{selected\.issues\}\/>/);
  assert.match(presence, /<OrganizationSignal issues=\{e\.issues\}\/>\s*<span>\{short\(e\.name\)\}/);
  assert.match(quality, /aria-label=\{"Сигнал качества: " \+ message\}/);
  assert.match(readFileSync("app/vitrina-quality-dashboard.css","utf8"),/\.vitrinaQSignalConfirmed/);
  assert.match(readFileSync("app/vitrina-quality-dashboard.css","utf8"),/\.vitrinaQSignalReview/);
});
test("unverified data are flagged for review, missing fields confirmed",()=>{
  const issues=findVitrinaQualityIssues({id:"oid",name:"ГАУЗ ГП № 1",now:2,rows:[
    {name:"Поликлиника",address:""},
    {name:"Поликлиника № 2",address:", Республика Татарстан, Казань, ул. Ленина, 1"},
  ]});
  assert.ok(issues.some(issue=>issue.level==="confirmed"));
  assert.ok(issues.some(issue=>issue.level==="review"));
  assert.equal(issues.filter(issue=>issue.level==="confirmed" && issue.field==="Адрес подразделения").length,1);
});
