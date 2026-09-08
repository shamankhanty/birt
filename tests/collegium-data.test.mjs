import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const data=JSON.parse(fs.readFileSync(new URL("../app/federal-control.json",import.meta.url),"utf8"));

test("collegium slice contains every source indicator",()=>{
  assert.equal(data.collegium.length,28);
  assert.equal(new Set(data.collegium.map(row=>row.id)).size,28);
  assert.equal(data.collegium[0].id,"1.1");
  assert.equal(data.collegium.at(-1).id,"1.25");
});

test("updated collegium facts and periods are preserved",()=>{
  const byId=new Map(data.collegium.map(row=>[row.id,row]));
  assert.equal(byId.get("1.4").federal,"4 118 · 86%");
  assert.equal(byId.get("1.4").regionalFact,"3 496 из 4 732 · 73,88%");
  assert.equal(byId.get("1.14").federal,"451 · 98%");
  assert.equal(byId.get("1.14").regionalFact,"99,78%");
  assert.equal(byId.get("1.20").federal,"120 · 93%");
  assert.equal(byId.get("1.20").regionalFact,"97%");
  assert.equal(byId.get("1.24").federal,"35 · 87%");
  assert.equal(byId.get("1.24").regionalFact,"98%");
  assert.equal(byId.get("1.24").regionalPeriod,"январь–август 2026");
});

test("invalid regional 200 percent plan does not replace the federal plan",()=>{
  const row=data.collegium.find(item=>item.id==="1.25");
  assert.equal(row.plan,"20%");
  assert.match(row.sourceNote,/200%/u);
});
