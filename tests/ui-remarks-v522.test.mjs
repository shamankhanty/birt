import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("extended summary exposes a visible all-except-contract button", () => {
  assert.match(
    page,
    /aria-label="Статус показателя"[\s\S]*?setExtendedStatusFilter\("all"\)[\s\S]*?setExtendedStatusFilter\("exceptContract"\)[\s\S]*?Все, кроме «В контракте»[\s\S]*?setExtendedStatusFilter\("achieved"\)/u,
  );
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
  assert.match(page, /const DASHBOARD_VERSION = "5\.2\.3"/u);
  assert.ok(page.indexOf('["max", "МАХ", "05"]') > page.indexOf('["divider", "В разработке", ""]'));
  assert.ok(page.includes('developmentSection ${tab === "max"'));
  assert.doesNotMatch(page, /className=\{tab === "max" \? "active" : ""\}/u);
  assert.match(css, /v5\.2\.3 hearing TOP-10 readability/u);
});
