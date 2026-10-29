import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mo = JSON.parse(readFileSync(new URL("../app/mo-data.json", import.meta.url), "utf8"));
const monthly = JSON.parse(readFileSync(new URL("../app/monthly-mo.json", import.meta.url), "utf8"));
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

const quantity = (value) => value.split("/").map((part) => Number(part.replace(/\s/g, "")));
const monthlyTotals = (metric) =>
  monthly[metric].rows.reduce(
    (totals, row) => {
      if (!row.julyQuantity) return totals;
      const [numerator, denominator] = quantity(row.julyQuantity);
      totals.numerator += numerator;
      totals.denominator += denominator;
      totals.populated += 1;
      return totals;
    },
    { numerator: 0, denominator: 0, populated: 0 },
  );

test("EPGU indicators keep separate cumulative numerators at 28.10.2026", () => {
  assert.equal(mo.egpu.date, "28.10.2026");
  assert.equal(mo.egpu2days.date, "28.10.2026");
  assert.deepEqual(
    [mo.egpu.numerator, mo.egpu.denominator],
    [43190, 43662],
  );
  assert.deepEqual(
    [mo.egpu2days.numerator, mo.egpu2days.denominator],
    [36924, 43662],
  );
  assert.notEqual(mo.egpu.numerator, mo.egpu2days.numerator);
});

test("full September EPGU tables use separate source columns", () => {
  for (const metric of ["egpu", "egpu2days"]) {
    assert.equal(monthly[metric].previousLabel, "Август 2026");
    assert.equal(monthly[metric].currentLabel, "Сентябрь 2026");
  }
  assert.deepEqual(monthlyTotals("egpu"), {
    numerator: 6684,
    denominator: 6690,
    populated: 77,
  });
  assert.deepEqual(monthlyTotals("egpu2days"), {
    numerator: 6077,
    denominator: 6690,
    populated: 77,
  });
});

test("September EPGU summary uses dataset month labels and verified totals", () => {
  assert.match(page, /6 684 из 6 690/);
  assert.match(page, /6 077 из 6 690/);
  assert.match(page, /matrixMetric === "egpu" \|\| matrixMetric === "egpu2days"/);
  assert.doesNotMatch(page, /source: "Заявления, рассмотренные за 2 суток"/);
});
