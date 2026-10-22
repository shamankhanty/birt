import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dashboard separates subsidy and collegium indicators above 50 percent of plan", () => {
  assert.match(page, /data-testid="plan-progress-focus"/u);
  assert.match(page, /\["agreement", "Субсидия", "Показатели соглашения"\]/u);
  assert.match(page, /\["collegium", "Коллегия", "Показатели протокола"\]/u);
  assert.match(page, /progress <= 50 \|\| progress >= 100/u);
});

test("focus calculation preserves direction and missing-data semantics", () => {
  assert.match(page, /\(plan \/ fact\) \* 100/u);
  assert.match(page, /\(fact \/ plan\) \* 100/u);
  assert.match(page, /fact === null/u);
  assert.match(page, /regionalControlStatus\(row, alternate\) !== "notAchieved"/u);
});
