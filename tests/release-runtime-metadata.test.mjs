import test from "node:test";
import assert from "node:assert/strict";
import { createReleaseRuntimeMetadata, RELEASE_VERSION } from "../lib/release-runtime-metadata.js";
import { readFile } from "node:fs/promises";

test("release UI metadata follows runtime operational cut", () => {
  const first = createReleaseRuntimeMetadata({ physicianWeeklySnapshot: { date: "11.09.2026", period: "01.09.2026–11.09.2026" } });
  const next = createReleaseRuntimeMetadata({ physicianWeeklySnapshot: { date: "17.09.2026", period: "01.09.2026–17.09.2026" } });
  assert.equal(first.version, next.version);
  assert.equal(first.operationalCut.period, "01.09.2026–11.09.2026");
  assert.equal(next.operationalCut.period, "01.09.2026–17.09.2026");
  assert.equal(next.ratingPeriod, "август 2026");
});

test("release version has one canonical source and preserves historical baseline references", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../baseline/manifest.json", import.meta.url), "utf8"));
  const historical = await readFile(new URL("../baseline/RELEASE_5.4.5.md", import.meta.url), "utf8");
  assert.equal(RELEASE_VERSION, "5.4.7");
  assert.match(page, /DASHBOARD_VERSION\s*=\s*RELEASE_VERSION/u);
  assert.doesNotMatch(page, /DASHBOARD_VERSION\s*=\s*"5\.4\.6"/u);
  assert.equal(manifest.baselineVersion, RELEASE_VERSION);
  assert.match(historical, /5\.4\.5/u);
});

test("legacy previous operational values remain an explicit bounded allowlist", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const allowed = ["81.50854673698926", "99.41902687000727", "98.63398669559959", "76.45487488333754", "83.94106729825947", "87.21910680643124", "98.91", "100", "96.83", "98.68", "92.313718328271", "692864", "20942", "35948"];
  const previousBlock = page.match(/const operationalRegionalPrevious:[\s\S]*?\n  \};/u)?.[0] ?? "";
  for (const value of allowed) assert.match(previousBlock, new RegExp(value.replace(".", "\\.")));
  assert.doesNotMatch(previousBlock, /2046140|624362|2911671/u);
});
