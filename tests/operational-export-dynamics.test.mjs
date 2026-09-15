import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const adapters = fs.readFileSync(new URL("../scripts/pipeline/adapters.py", import.meta.url), "utf8");
const mo = JSON.parse(fs.readFileSync(new URL("../app/mo-data.json", import.meta.url), "utf8"));
const operational = JSON.parse(fs.readFileSync(new URL("../app/operational-mo.json", import.meta.url), "utf8"));
const status = JSON.parse(fs.readFileSync(new URL("../app/organization-status.json", import.meta.url), "utf8"));

test("indicator operational mode means current export versus previous export", () => {
  assert.match(page, /useState<"operational" \| "month">\("operational"\)/u);
  assert.match(page, /Оперативно — текущая выгрузка к предыдущей/u);
  assert.match(page, /Предыдущая выгрузка/u);
  assert.match(page, /Текущая выгрузка/u);
  assert.match(page, /<small>Разница<\/small>/u);
  assert.match(page, /snapshotDistanceDays/u);
});

test("current operational comparison map identifies the previous source export", () => {
  assert.match(page, /birth: \{ previous: "01\.01–07\.09\.2026", current: "01\.01–11\.09\.2026" \}/u);
  assert.match(page, /smp: \{ previous: "01\.01–28\.08\.2026", current: "01\.01–11\.09\.2026" \}/u);
  assert.match(page, /tmkMaxCount: \{ previous: "01\.01–07\.09\.2026", current: "01\.01–11\.09\.2026" \}/u);
  assert.match(page, /elnMaxCount: \{ previous: "01\.01–07\.09\.2026", current: "01\.01–11\.09\.2026" \}/u);
});

test("regional cards use the approved previous export totals, not partial row matching", () => {
  assert.match(page, /tmkMaxCount: 20942/u);
  assert.match(page, /elnMaxCount: 35948/u);
  assert.match(page, /shortInput: 692864/u);
  assert.match(page, /hospital: 83\.94106729825947/u);
  assert.match(page, /selectedUnitDataset\.fact \/ selectedUnitDataset\.plan/u);
});

test("weekly update adapters carry previous cut metadata forward", () => {
  assert.match(adapters, /def previous_cut_metadata/u);
  assert.match(adapters, /previousDate/u);
  assert.match(adapters, /previousPeriod/u);
  assert.match(adapters, /adapt_ambulatory_cases[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_preventive[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_short_input[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_fap[\s\S]*previous_cut_metadata/u);
  assert.match(adapters, /adapt_asu_smp[\s\S]*previous_cut_metadata/u);
});

test("count tables show dates, absolute difference and relative change", () => {
  assert.match(page, /Текущая выгрузка[\s\S]*currentSnapshot/u);
  assert.match(page, /Предыдущая выгрузка[\s\S]*previousSnapshot/u);
  assert.match(page, /Изменение, %/u);
  assert.match(page, /o\.trend \/ o\.previous/u);
  assert.match(page, /новое значение/u);
});
