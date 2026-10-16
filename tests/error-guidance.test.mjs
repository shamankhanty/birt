import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = path => JSON.parse(fs.readFileSync(path,"utf8"));
const guide = read("app/error-guidance.json");
const page = fs.readFileSync("app/page.tsx","utf8");
const annual = read("app/error-cumulative.json");
const weekly = read("app/error-categories.json");
const byName = new Map();
const byCode = new Map();
for (const item of guide.items) {
  for (const name of item.names) { assert.ok(!byName.has(name)); byName.set(name,item); }
  assert.ok(!byCode.has(item.code)); byCode.set(item.code,item);
}
test("every current annual and weekly category has actionable guidance", () => {
  for(const dataset of [annual,weekly])for(const category of dataset.items){
    const item=byName.get(category.name);
    assert.ok(item,category.name);
    assert.ok(item.description && item.owner && item.retry && item.steps.length>=2);
    assert.ok(item.steps.every(step=>typeof step==="string" && step.length>10));
  }
  assert.equal(byCode.size,37);
  assert.equal(guide.sourceUrl,"https://wiki.is-mis.ru/pages/viewpage.action?pageId=107708704");
});
test("ambiguous errors require details and duplicate registration is not blindly retried", () => {
  for(const code of ["VALIDATION_ERROR","VALSYS_REJECT","RUNTIME_ERROR"])assert.equal(byCode.get(code).needsDetails,true);
  assert.match(byCode.get("NOT_UNIQUE_PROVIDED_ID").retry,/не нужна/u);
  assert.match(byCode.get("RMIS_ERROR").retry,/автоматический/u);
  assert.match(byCode.get("NO_SNILS").steps.join(" "),/Не подставлять фиктивные/u);
});
test("guidance is accessible from category and organization views with a safe unknown-category fallback",()=>{
  assert.ok(page.includes("showErrorGuide(e.name)"));
  assert.ok(page.includes("showErrorGuide(category.name)"));
  assert.ok(page.includes('id="remd-error-guide"'));
  assert.ok(page.includes('htmlFor="remd-error-guide-select"'));
  assert.ok(page.includes("Для новой категории инструкция пока не сопоставлена"));
  assert.ok(page.includes('item.names.includes(selectedErrorCategory ?? "")'));
});
