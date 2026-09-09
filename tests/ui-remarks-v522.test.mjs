import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("extended summary has all-except-contract filter", () => {
  assert.match(page, /exceptContract/u);
  assert.match(page, /Все, кроме «В контракте»/u);
});

test("duplicate MAX regional block is removed", () => {
  assert.doesNotMatch(page, /regionalMaxPanel/u);
  assert.doesNotMatch(page, /РЕГИОНАЛЬНЫЙ КОНТРОЛЬ · МАХ/u);
});

test("MAX has one active service and compact monthly cards", () => {
  assert.match(page, /maxServiceSwitch/u);
  assert.match(page, /setMaxService\("visit"\)/u);
  assert.match(page, /setMaxService\("tmk"\)/u);
  assert.match(page, /setMaxService\("eln"\)/u);
  assert.match(page, /maxMonthCards/u);
  assert.match(css, /v5\.2\.2 compact MAX and service selector/u);
});
