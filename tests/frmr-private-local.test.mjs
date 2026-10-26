import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { maskSnils, parseLocalPrivateFrmr } from "../lib/frmr-private-local.js";

const component = fs.readFileSync("app/frmr-reconciliation.tsx", "utf8");
const reader = fs.readFileSync("lib/frmr-private-local.js", "utf8");
const style = fs.readFileSync("app/frmr-reconciliation.module.css", "utf8");

test("private identity file is never bundled in GitHub Pages and no transport is used", () => {
  assert.doesNotMatch(reader, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|localStorage|sessionStorage/);
  assert.doesNotMatch(component, /uploadPrivateData|\/api\/.*(?:private|frmr)/);
  assert.match(reader, /file\.arrayBuffer\(\)/u);
  assert.match(component, /Excel не передаётся в GitHub/u);
  assert.match(component, /после перезагрузки страницы сведения исчезнут/u);
});

test("MO private worksheet is strictly scoped to OID and source cut", () => {
  assert.match(reader, /sourceOid !== fullOid/u);
  assert.match(reader, /cutDate !== "22\.10\.2026"/u);
  assert.match(reader, /records\.length !== expectedCount/u);
  assert.match(reader, /СНИЛС/u);
  assert.match(reader, /Должность ФРМР/u);
  assert.match(reader, /Тип расхождения/u);
  assert.match(component, /parseLocalPrivateFrmr\(file, selected\.id, selected\.current\)/u);
  assert.match(component, /resetPrivate\(\);setView\("organization"\)/u);
  assert.match(component, /resetPrivate\(\);\}\}/u);
});

test("employee is discoverable in a local file without exposing the identifier by default", async () => {
  assert.equal(maskSnils("123-456-789 01"), "••• ••• 789 01");
  assert.equal(maskSnils(""), "скрыт");
  await assert.rejects(
    () => parseLocalPrivateFrmr({ name: "wrong.csv", size: 1 }, "1094", 87),
    /XLSX/,
  );
  assert.match(component, /showPrivateIdentifiers\] = useState\(false\)/u);
  assert.match(component, /ФИО в ФРМР нет/u);
  assert.match(component, /Расписание ГИС \(не подтверждено\)/u);
  assert.match(component, /r\.snils\.includes\(digits\)/u);
  assert.match(component, /Закрыть и очистить данные/u);
  assert.match(style, /privateTableWrap/u);
});
