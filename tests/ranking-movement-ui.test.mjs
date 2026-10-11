import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("indicator view shows MO movement only for comparable source rows", () => {
  assert.match(page, /comparableRankRows/u);
  assert.match(page, /row\.previous !== null && row\.trend !== null/u);
  assert.match(page, /previousRank - currentRank/u);
  assert.match(page, /Динамика мест/u);
  assert.match(page, /Стали выше/u);
  assert.match(page, /Стали ниже/u);
  assert.match(page, /showRankChange/u);
});
