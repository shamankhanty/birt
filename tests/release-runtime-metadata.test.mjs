import test from "node:test";
import assert from "node:assert/strict";
import { createReleaseRuntimeMetadata } from "../lib/release-runtime-metadata.js";

test("release UI metadata follows runtime operational cut", () => {
  const first = createReleaseRuntimeMetadata({ physicianWeeklySnapshot: { date: "11.09.2026", period: "01.09.2026–11.09.2026" } });
  const next = createReleaseRuntimeMetadata({ physicianWeeklySnapshot: { date: "17.09.2026", period: "01.09.2026–17.09.2026" } });
  assert.equal(first.version, next.version);
  assert.equal(first.operationalCut.period, "01.09.2026–11.09.2026");
  assert.equal(next.operationalCut.period, "01.09.2026–17.09.2026");
  assert.equal(next.ratingPeriod, "август 2026");
});
