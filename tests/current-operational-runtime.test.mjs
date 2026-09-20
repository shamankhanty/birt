import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentOperationalRuntime } from "../lib/current-operational-runtime.js";

test("operational cut changes through runtime data without registry/page changes", () => {
  const first = createCurrentOperationalRuntime({ operationalMo: { max: { date: "11.09.2026", period: "01.01–11.09.2026", previousDate: "07.09.2026", fact: 10 } } });
  const next = createCurrentOperationalRuntime({ operationalMo: { max: { date: "17.09.2026", period: "01.01–17.09.2026", previousDate: "11.09.2026", fact: 12 } } });
  assert.equal(first.max.date, "11.09.2026");
  assert.equal(next.max.date, "17.09.2026");
  assert.equal(next.max.previousDate, "11.09.2026");
  assert.equal(next.max.fact, 12);
});
