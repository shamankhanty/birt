import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync("app/mo-registry.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");
const ids = {
  kazan: "1.2.643.5.1.13.13.12.2.16.1090",
  nabDgp: "1.2.643.5.1.13.13.12.2.16.1066",
  nabGp: "1.2.643.5.1.13.13.12.2.16.1051",
};

function org(oid) {
  return registry.organizations.find((item) => item.oid === oid);
}

function compact(name) {
  return name
    .replace(/№\s*(\d+)/gu, "№$1")
    .replace(/\s*,\s*(?:Казань|Наб\.\s*Челны)$/iu, "")
    .replace(/\s+г\.?\s*(?:Казань|Наб\.\s*Челны)$/iu, "")
    .trim()
    .toLocaleLowerCase("ru");
}

test("registry keeps the two DGP No. 6 organizations distinct and disambiguates them", () => {
  const kazan = org(ids.kazan);
  const nabDgp = org(ids.nabDgp);
  assert.ok(kazan && nabDgp);
  assert.notEqual(kazan.oid, nabDgp.oid);
  assert.equal(compact(kazan.shortName), compact(nabDgp.shortName));
  assert.match(page, /function displayMoName\(name: string, oid\?: string \| null\)/);
  assert.match(page, /compactMoNameCounts/);
  assert.match(page, /Наб\. Челны/);
});

test("GP No. 6 in Naberezhnye Chelny is not mixed with DGP No. 6", () => {
  assert.notEqual(compact(org(ids.nabGp).shortName), compact(org(ids.nabDgp).shortName));
  const rows = physicians.datasets.doctorsAll.rows.filter((row) =>
    [ids.kazan, ids.nabDgp, ids.nabGp].includes(row.oid),
  );
  assert.equal(new Set(rows.map((row) => row.oid)).size, 3);
});

test("display disambiguation does not alter physician facts or OID identity", () => {
  for (const dataset of Object.values(physicians.datasets)) {
    for (const oid of Object.values(ids)) {
      for (const row of dataset.rows.filter((item) => item.oid === oid)) {
        if (row.count == null || row.volume == null) continue;
        assert.equal(typeof row.count, "number");
        assert.equal(typeof row.volume, "number");
        assert.equal(row.fact, (row.count / row.volume) * 100);
        assert.equal(row.oid, oid);
      }
    }
  }
  assert.match(page, /displayMoName\(row\.name, row\.oid\)/);
});

import { cleanMoName, reportMoName, createMoRegistryRuntime } from "../lib/mo-registry.js";

const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const runtime = createMoRegistryRuntime(registry);
const displaySource = page.slice(
  page.indexOf("function compactMoDisplayName("),
  page.indexOf("const monthlyMoData ="),
).replace("name: string, oid?: string | null", "name, oid")
 .replace("metric: string, row: MoRow", "metric, row")
 .replace("name: string", "name")
 .replace("new Map<string, number>()", "new Map()");
const displayReport = new Function(
  "cleanMoName", "reportMoName", "moRegistry", "registryByOid", "registryOrganizationForMetric",
  displaySource + "\nreturn displayReportMoName;",
)(cleanMoName, reportMoName, registry, runtime.byOid, runtime.organizationForMetric);

test("operational GP No. 7 rows show the correct city from their OID", () => {
  const rows = weekly.datasets.doctor500_dentist;
  const kazan = rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.1153");
  const chelny = rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.1115");
  assert.ok(kazan && chelny);
  const before = JSON.stringify([kazan, chelny]);
  assert.equal(cleanMoName(kazan.name), cleanMoName(chelny.name));
  assert.equal(displayReport("doctor500_dentist", kazan), "ГП №7, Казань");
  assert.equal(displayReport("doctor500_dentist", chelny), "ГП №7, Наб. Челны");
  assert.equal(displayReport("doctor500_dentist", {...kazan, name: "ГП №7"}), "ГП №7, Казань");
  assert.equal(displayReport("doctor500_dentist", {...chelny, name: "ГП №7"}), "ГП №7, Наб. Челны");
  assert.equal(JSON.stringify([kazan, chelny]), before);
});

test("contextual report naming is preserved and ambiguous city-free names are not guessed", () => {
  assert.equal(displayReport("egpu", {name: "РКБ", oid: "1.2.643.5.1.13.13.12.2.16.1094"}), "Спасская ЦРБ");
  assert.equal(displayReport("doctor500_dentist", {name: "ГП №7"}), "ГП №7");
  assert.equal(displayReport("doctorsAll", {name: org(ids.kazan).name, oid: ids.kazan}), "ДГП №6, Казань");
  assert.equal(displayReport("doctorsAll", {name: org(ids.nabDgp).name, oid: ids.nabDgp}), "ДГП №6, Наб. Челны");
});

test("indicator table and ranking cards use the same OID-aware report display", () => {
  assert.match(page, /\{displayReportMoName\(matrixMetric, o\)\}/u);
  assert.doesNotMatch(page, /\{reportMoName\(matrixMetric, o\.name\)\}/u);
  assert.match(page, /const displayName = displayReportMoName\(metric, row\)/u);
  assert.match(page, /\? displayReportMoName\(metric, r\)/u);
});
