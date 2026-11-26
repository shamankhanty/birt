import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8"));
const datasets = [read("incident38-cities.json"), read("incident38-districts.json")];
const sabinskyOid = "1.2.643.5.1.13.13.12.2.16.1126";

test("И38: specialty code/name binding and unique OID are consistent in both datasets", () => {
  const canonical = new Map(datasets[0].specialties.map(({code,name}) => [code,name]));
  assert.equal(canonical.size, datasets[0].specialties.length);
  const allOids = new Set();
  for (const dataset of datasets) {
    assert.deepEqual(new Map(dataset.specialties.map(({code,name}) => [code,name])), canonical);
    assert.equal(dataset.orgCount, dataset.orgs.length);
    for (const org of dataset.orgs) {
      assert.ok(!allOids.has(org.oid), `duplicate OID: ${org.oid}`);
      allOids.add(org.oid);
      assert.equal(org.specialties.length, canonical.size, org.name);
      const codes = new Set();
      for (const row of org.specialties) {
        assert.ok(canonical.has(row.code), `${org.name}: unknown code ${row.code}`);
        assert.equal(row.name, canonical.get(row.code), `${org.name}: mislabeled specialty ${row.code}`);
        assert.ok(!codes.has(row.code), `${org.name}: duplicate specialty ${row.code}`);
        codes.add(row.code);
        for (const key of ["norm","slots","epguNorm","epguSlots"]) {
          assert.ok(row[key] === null || (typeof row[key] === "number" && Number.isFinite(row[key]) && row[key] >= 0), `${org.name} ${row.name}: invalid ${key}`);
        }
      }
    }
  }
});

test("И38: Сабинская ЦРБ — детские специалисты не наследуют показатели взрослых и педиатра", () => {
  const org = datasets.flatMap(d => d.orgs).find(o => o.oid === sabinskyOid);
  assert.ok(org, "Сабинская ЦРБ отсутствует");
  const byCode = new Map(org.specialties.map(s => [s.code,s]));
  for (const code of ["17","26"]) {
    const row = byCode.get(code);
    assert.ok(row);
    assert.deepEqual([row.norm,row.slots,row.epguNorm,row.epguSlots], [0,0,0,0], row.name);
  }
  assert.deepEqual([byCode.get("16").norm,byCode.get("16").epguSlots], [2240,1592], "педиатр");
  assert.deepEqual([byCode.get("23").norm,byCode.get("23").epguSlots], [170,175], "хирург");
  assert.deepEqual([byCode.get("15").norm,byCode.get("15").epguSlots], [350,248], "офтальмолог");
  assert.deepEqual([byCode.get("14").norm,byCode.get("14").epguSlots], [300,168], "оториноларинголог");
});

test("И38: карточка МО направляет на сверку ФРМР при нулевом нормативе и наличии слотов", () => {
  const ui = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  assert.match(ui, /row\.norm === 0 && row\.epguSlots !== null && row\.epguSlots > 0/);
  assert.match(ui, /Проверить ФРМР/);
  assert.match(ui, /onOpenFrmrMo\(selectedOrg\.oid\)/);
  assert.match(ui, /карточка этой МО в разделе 06/);
});
