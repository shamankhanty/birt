import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { buildOctoberRating } from "../lib/october-rating.js";

const read = path => JSON.parse(fs.readFileSync(path, "utf8"));

test("October uses closed data in the existing rating and preserves missing comparisons", () => {
  const months = read("app/monthly-2026-10.json");
  const september = read("app/rating/september-v2-inputs.json");
  const rows = buildOctoberRating(september, { ...read("app/monthly-mo.json"), ...months }, read("config/september-rating-v2.json"));
  assert.equal(rows.length, september.organizations.length);
  assert.equal(rows.filter(row => row.complete).length, 105);
  assert.ok(rows.filter(row => !row.complete).every(row => row.place === null && row.score === null));
  const agryz = rows.find(row => row.key.endsWith(".1088"));
  const preventive = agryz.metrics.find(metric => metric.id === "semd228");
  assert.deepEqual([preventive.numerator, preventive.denominator, preventive.period], [13426, 16875, "01.01–31.10.2026"]);
  assert.equal(agryz.metrics.find(metric => metric.id === "egpu").period, "01.10–31.10.2026");
  assert.ok(months.semd228.rows.every(row => row.june === null && row.change === null));
  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(page, /Октябрь · срез 122\/228/);
});

test("Kazan DGP №2: dentist 500+ is not applicable for October only after staff absence confirmation", () => {
  const sept = read("app/rating/september-v2-inputs.json");
  const month = read("app/monthly-mo.json");
  const data = { ...month, ...read("app/monthly-2026-10.json") };
  const policy = read("config/september-rating-v2.json");
  const kazanOid = "1.2.643.5.1.13.13.12.2.16.1182";
  const chelnyOid = "1.2.643.5.1.13.13.12.2.16.1045";
  const october = buildOctoberRating(sept, data, policy);
  const kazan = october.find(row => row.key === kazanOid);
  const dentist = kazan.metrics.find(metric => metric.id === "doctor500_dentist");
  const octoberSource = month.doctor500_dentist.rows.find(row => row.oid === kazanOid);
  const septemberDentist = sept.organizations.find(row => row.key === kazanOid).metrics.find(metric => metric.id === "doctor500_dentist");

  assert.equal(octoberSource.sourceStatus, "no_source_row");
  assert.equal(octoberSource.julyQuantity, null, "No invented source denominator");
  assert.deepEqual([septemberDentist.numerator, septemberDentist.denominator, septemberDentist.status], [0,1,"available"], "September is unchanged");
  assert.equal(dentist.status, "not_applicable");
  assert.equal(dentist.numerator, null);
  assert.equal(dentist.denominator, null);
  assert.equal(dentist.fact, null);
  assert.match(dentist.reason, /подтверждению ДГП № 2 г. Казани/);
  assert.equal(kazan.complete, true, "Other October indicators must suffice for official score");
  assert.ok(kazan.place !== null && kazan.place >= 1, "Official rank is assigned");
  assert.ok(Number.isFinite(kazan.score), "Computed score remains numeric");
  assert.ok(kazan.metrics.filter(metric => metric.id !== "doctor500_dentist").every(metric => metric.status === "available"));

  const chelny = october.find(row => row.key === chelnyOid);
  const chelnyDentist = chelny.metrics.find(metric => metric.id === "doctor500_dentist");
  assert.equal(chelnyDentist.status, "available", "Do not affect similarly named MO in Naberezhnye Chelny");
  assert.deepEqual([chelnyDentist.numerator, chelnyDentist.denominator], [0,2]);
  const ui = fs.readFileSync("app/september-rating.tsx", "utf8");
  assert.match(ui,/m\.reason\?\?'Не применяется: нулевой знаменатель'/);
});

test("explicit October applicability does not override an actual source entry", () => {
  const sept = read("app/rating/september-v2-inputs.json");
  const monthly = read("app/monthly-mo.json");
  const dentist = {
    ...monthly.doctor500_dentist,
    rows: monthly.doctor500_dentist.rows.map(row => row.oid.endsWith(".1182") ?
      {...row, julyQuantity: "0 / 1", july: 0, sourceStatus: undefined} : row),
  };
  const october = buildOctoberRating(sept, {...monthly,...read("app/monthly-2026-10.json"), doctor500_dentist:dentist}, read("config/september-rating-v2.json"));
  const dgp = october.find(row => row.key.endsWith(".1182"));
  const actual = dgp.metrics.find(metric => metric.id === "doctor500_dentist");
  assert.equal(actual.status, "available");
  assert.equal(actual.denominator, 1);
});
