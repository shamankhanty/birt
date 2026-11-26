import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesMoSearch } from "../lib/incident38-mo-search.js";

const cities = JSON.parse(readFileSync(new URL("../app/incident38-cities.json", import.meta.url), "utf8"));
const org = cities.orgs.find(item => item.oid === "1.2.643.5.1.13.13.12.2.16.1148");

test("И‑38: ГДБ № 1 им. М. Ш. Уразаевой есть в актуальной городской выгрузке", () => {
  assert.ok(org, "OID 1148 must be present");
  assert.equal(org.city, "Казань");
  assert.equal(org.code, "6403");
  assert.ok(org.name.includes("ГДБ № 1"));
});

test("И‑38: сокращения ГДБ1, ГДБ №1 и ГДБ № 1 находят одно МО", () => {
  for (const query of ["ГДБ1", "гдб 1", "Гдб №1", "гдб № 1", "Уразаевой"]) {
    assert.equal(matchesMoSearch(org.name, query), true, query);
    const hits = cities.orgs.filter(x => matchesMoSearch(x.name, query));
    assert.equal(hits.some(x => x.oid === org.oid), true, query);
  }
  assert.equal(matchesMoSearch(org.name, "ГДБ № 2"), false);
});

test("И‑38: поиск рейтинга и карточки использует одинаковую нормализацию", () => {
  const ui = readFileSync(new URL("../app/incident38-dashboard.tsx", import.meta.url), "utf8");
  assert.match(ui, /matchesMoSearch\(org\.name, organizationSearch\)/);
  assert.match(ui, /matchesMoSearch\(org\.name, matrixSearch\)/);
  assert.match(ui, /matchesMoSearch\(shownOrgName\(org\), matrixSearch\)/);
});
