import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => JSON.parse(readFileSync(new URL("../app/" + name, import.meta.url), "utf8"));

test("Section 06 keeps overview first and routes organization work to unified MO card", () => {
  const page = readFileSync(new URL("../app/frmr-reconciliation.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../app/frmr-mo-workspace.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<"minister" \| "organization" \| "audit">\("minister"\)/);
  assert.match(page, /Обзор<\/button>/);
  assert.match(page, /view === "minister" \? \(/);
  assert.match(page, /FrmrMoWorkspace key=\{selected.id\} selectedId=\{selected.id\} selectedName=\{selected.name\}/);
  assert.doesNotMatch(page, /Сверка СП с ФРМО<\/button>/);
  assert.match(card, /Все расхождения выбранной МО/);
  assert.match(card, /Должности \/ МО/);
  assert.match(card, /Привязки СП/);
  assert.match(card, /СП ↔ ФРМО/);
  assert.match(card, /Экспорт CSV/);
});

test("Saby has one stable MO identity in both sources, without summing different units", () => {
  const data = read("frmr-all-specialties.json");
  const audit = read("frmr-sp-audit-20261119.json");
  const linkage = read("frmo-linkage-data.json");
  const staff = data.summary.rows.find(r => r[0] === "1126");
  assert.ok(staff);
  assert.equal(staff[4], staff[5] + staff[6]);
  const links = linkage.organizations.filter(x => x.parentOids.includes("1.2.643.5.1.13.13.12.2.16.1126"));
  assert.equal(links.length, 1);
  assert.equal(links[0].code, "3801");
  const match = audit.summary.find(r => r.id === links[0].code);
  assert.ok(match);
  const rows = audit.records.filter(r => r.mo === match.id);
  assert.equal(rows.length, match.current);
  assert.ok(rows.every(r => Array.isArray(r.flags)));
  const flagged = rows.filter(r => r.flags.length).length;
  assert.equal(flagged, 24);
  assert.equal(data.summary.sourceCut, "19.11.2026");
  assert.equal(audit.sourceCut, "19.11.2026");
});
