import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFrmrScope } from "../lib/frmr-scope.js";
import { frmrControlView, compareFrmrControl } from "../lib/frmr-control.js";

const read = name => JSON.parse(readFileSync(new URL("../app/" + name, import.meta.url), "utf8"));
const raw = read("frmr-all-specialties.json");
const registry = read("mo-registry.json");
const types = read("frmr-sp-types.json");
const previous = read("frmr-previous-control.json");
const registryOids = new Set(registry.organizations.map(row => row.oid));
const stateParticipationAoIds = new Set(["1191","14163","63362"]);
const prefix = "1.2.643.5.1.13.13.12.2.16.";
const group = ([id,name]) => registryOids.has(prefix+id) || stateParticipationAoIds.has(id) ? "state"
  : /^(ООО|ЧУЗ|АО|ИП|АНО|ЗАО|ОАО)(?=\s|["«]|$)/u.test(name.trim()) ? "private" : "unknown";
const ids = Object.fromEntries(["state","private","unknown"].map(key =>
  [key,new Set(raw.summary.rows.filter(row => group(row) === key).map(row => row[0]))]));

test("FRMR source has 113 public/state-participation and 24 private organizations, without silent classification", () => {
  assert.equal(raw.summary.sourceCut,"19.11.2026");
  assert.equal(raw.summary.rows.length,137);
  assert.equal(ids.state.size,113);
  assert.equal(ids.private.size,24);
  assert.equal(ids.unknown.size,0);
  assert.equal(ids.state.size+ids.private.size+ids.unknown.size,raw.summary.rows.length);
  for(const id of ["1191","14163","63362"])assert.ok(ids.state.has(id),"RT state-participation AO must stay in state group: "+id);
  assert.ok(ids.private.has("10633"),"AO AVA Kazan is not part of the state-participation exceptions");
  assert.ok(ids.state.has("1126"),"Sabinskaya must stay in the state view");
});

test("Overview groups reconcile every source record and both independent control stages", () => {
  const scoped = applyFrmrScope(raw,types.types).data;
  const sourceMoIds = new Set(scoped.departments.mos);
  for(const key of ["state","private"]){
    const chosen = ids[key];
    const expected = scoped.records.rows.filter(row=>chosen.has(scoped.departments.mos[row[0]])).length;
    const summed = scoped.summary.rows.filter(row=>chosen.has(row[0])).reduce((sum,row)=>sum+row[4],0);
    assert.equal(expected,summed,key+" total across two levels");
    for(const level of ["mo","department"]){
      const view = frmrControlView(scoped,level,"",types.types);
      const rows = view.summary.rows.filter(row=>chosen.has(row[0]));
      const count = rows.reduce((sum,row)=>sum+row[4],0);
      const sourceCount = view.records.rows.filter(row=>chosen.has(view.departments.mos[row[0]])).length;
      assert.equal(count,sourceCount,key+" "+level);
      const compared = compareFrmrControl(previous,view,level);
      const common = rows.filter(row=>compared.byMo[row[0]]!==null);
      const previousCount = common.reduce((sum,row)=>sum+compared.byMo[row[0]],0);
      const currentCount = common.reduce((sum,row)=>sum+row[4],0);
      assert.ok(Number.isInteger(previousCount) && Number.isInteger(currentCount));
      assert.ok(previousCount>=0 && currentCount>=0);
    }
  }
  assert.ok([...ids.state].every(id=>sourceMoIds.has(id)||raw.summary.rows.some(row=>row[0]===id)));
  assert.equal(scoped.summary.rows.reduce((sum,row)=>sum+row[4],0),scoped.records.rows.length);
});

test("overview state/private switch filters all summary, charts, specialties and ranking; MO card stays accessible", () => {
  const ui = readFileSync(new URL("../app/frmr-reconciliation.tsx",import.meta.url),"utf8");
  const css = readFileSync(new URL("../app/frmr-reconciliation.module.css",import.meta.url),"utf8");
  assert.match(ui,/useState<"state" \| "private">\(\(\) => \{/);
  assert.match(ui,/if \(!matchedInitialMoId\) return "state"/);
  assert.match(ui,/Государственные<\/button>/);
  assert.match(ui,/Частные<\/button>/);
  assert.match(ui,/view === "minister" && <div className=\{styles\.ownershipSwitch\}/);
  assert.match(ui,/const orgs = allOrgs\.filter\(row => frmrOwnership\(row\.id, row\.name\) === ownership\)/);
  assert.match(ui,/const selected = allOrgs\.find/);
  assert.match(ui,/const sortedOrgs = \[\.\.\.allOrgs\]/);
  assert.match(ui,/for \(const row of orgs\) for \(const \[role, count\] of row\.specialties\)/);
  assert.match(ui,/selectedMoIds\.has\(scopedAll\.departments\.mos\[row\[0\]\]\)/);
  assert.match(ui,/\[controlLevel, spType, filter, search, sort, ownership\]/);
  assert.match(ui,/const comparableOrgs = orgs\.filter\(row => row\.previous !== null\)/);
  assert.match(ui,/trendBars\(isAll \? \[\[comparisonOverview\.cut/);
  assert.match(ui,/targetOid\?\.startsWith\(officialPrefix\)/);
  assert.match(css,/\.ownershipSwitch button\.ownershipActive/);
});
