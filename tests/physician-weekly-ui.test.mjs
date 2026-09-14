import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const weekly = JSON.parse(fs.readFileSync("app/physician-weekly-snapshot.json", "utf8"));
const monthly = JSON.parse(fs.readFileSync("app/monthly-mo.json", "utf8"));
const physicians = JSON.parse(fs.readFileSync("app/physician-metrics.json", "utf8"));

test("partial September 500+ is operational control and does not replace monthly rating", () => {
  assert.equal(weekly.date, "11.09.2026");
  assert.match(weekly.period, /01\.01–11\.09\.2026/u);
  assert.match(page, /physician-weekly-snapshot\.json/u);
  assert.match(page, /Оперативный недельный контроль «500\+»/u);
  assert.match(page, /В месячный рейтинг не включается/u);
  assert.match(page, /operational500_/u);
  for (const id of Object.keys(weekly.summary)) {
    assert.ok(physicians.datasets[id].periodType === "month", `${id} must keep the closed monthly dataset`);
    assert.ok(monthly[id], `${id} remains represented by its full-month comparison`);
  }
});
