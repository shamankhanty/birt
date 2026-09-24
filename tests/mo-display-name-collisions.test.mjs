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
        assert.equal(typeof row.count, "number");
        assert.equal(typeof row.volume, "number");
        assert.equal(row.fact, (row.count / row.volume) * 100);
        assert.equal(row.oid, oid);
      }
    }
  }
  assert.match(page, /displayMoName\(row\.name, row\.oid\)/);
});
