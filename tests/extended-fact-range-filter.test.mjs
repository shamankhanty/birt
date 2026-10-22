import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("extended dashboard filters cards by independent RT fact ranges", () => {
  assert.doesNotMatch(page, /data-testid="plan-progress-focus"/u);
  assert.match(
    page,
    /type ExtendedFactRange = "all" \| "lt50" \| "50to70" \| "70to90"/u,
  );
  assert.match(page, /\["lt50", "До 50%"\]/u);
  assert.match(page, /\["50to70", "50–70%"\]/u);
  assert.match(page, /\["70to90", "70–90%"\]/u);
});

test("fact ranges have non-overlapping boundaries and combine with existing filters", () => {
  assert.match(page, /regionalFactPercent < 50/u);
  assert.match(page, /regionalFactPercent >= 50 && regionalFactPercent < 70/u);
  assert.match(page, /regionalFactPercent >= 70 && regionalFactPercent < 90/u);
  assert.match(page, /factRangeMatches &&/u);
  assert.match(page, /extendedStatusFilter === "all"/u);
  assert.match(page, /extendedCategory === "all"/u);
});

test("default range keeps every card and missing facts are not converted to zero", () => {
  assert.match(page, /useState<ExtendedFactRange>\("all"\)/u);
  assert.match(page, /extendedFactRange === "all" \|\|/u);
  assert.match(page, /regionalFactPercent !== null/u);
});
