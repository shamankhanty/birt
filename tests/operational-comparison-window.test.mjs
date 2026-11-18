import test from "node:test";
import assert from "node:assert/strict";
import { selectOperationalComparison } from "../lib/operational-comparison.js";

const row = (fact, previous = null) => ({ oid: "1", name: "МО", fact, previous, trend: previous === null ? null : fact - previous });

test("Sunday uses Monday when Thursday is only three days old", () => {
  const current = { date: "15.11.2026", previousDate: "12.11.2026", mode: "count", rows: [row(30, 20)] };
  const monday = { date: "09.11.2026", fact: 10, rows: [row(10)] };
  const result = selectOperationalComparison(current, [monday]);
  assert.equal(result.previousDate, "09.11.2026");
  assert.equal(result.rows[0].previous, 10);
  assert.equal(result.rows[0].trend, 20);
  assert.equal(result.comparisonFact, 10);
});

test("immediate predecessor remains valid at five days", () => {
  const result = selectOperationalComparison({ date: "15.11.2026", previousDate: "10.11.2026", rows: [row(30, 20)] });
  assert.equal(result.previousDate, "10.11.2026");
  assert.equal(result.rows[0].previous, 20);
});

test("short interval without older confirmed values has no dynamics", () => {
  const result = selectOperationalComparison({ date: "15.11.2026", previousDate: "12.11.2026", rows: [row(30, 20)] });
  assert.equal(result.previousDate, undefined);
  assert.equal(result.rows[0].previous, null);
  assert.equal(result.rows[0].trend, null);
});

test("comparison reset does not reuse earlier methodology", () => {
  const result = selectOperationalComparison({ date: "15.11.2026", comparisonReset: true, rows: [row(30)] }, [
    { date: "09.11.2026", rows: [row(10)] },
  ]);
  assert.equal(result.previousDate, undefined);
});

test("the reset cut becomes the first eligible baseline for later exports", () => {
  const result = selectOperationalComparison({ date: "20.11.2026", rows: [row(30)] }, [
    { date: "09.11.2026", rows: [row(10)] },
    { date: "15.11.2026", comparisonReset: true, rows: [row(20)] },
  ]);
  assert.equal(result.previousDate, "15.11.2026");
  assert.equal(result.rows[0].previous, 20);
});
