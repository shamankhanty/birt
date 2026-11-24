import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scheduleIdentity } from "../lib/vitrina-management.js";
import { sortVitrinaRows } from "../lib/vitrina-sort.js";

const rows = [
  { id: "a", name: "Больница Б", before: 4, now: 8, delta: 4 },
  { id: "b", name: "Больница А", before: 10, now: 5, delta: -5 },
  { id: "c", name: "Больница В", before: 1, now: 1, delta: 0 },
];

test("Vitrina sorts all four columns in both directions", () => {
  const expected = {
    name: ["b", "a", "c"],
    before: ["c", "a", "b"],
    now: ["c", "b", "a"],
    delta: ["b", "c", "a"],
  };
  for (const [column, asc] of Object.entries(expected)) {
    assert.deepEqual(sortVitrinaRows(rows, column, "asc").map(row => row.id), asc, column);
    assert.deepEqual(sortVitrinaRows(rows, column, "desc").map(row => row.id), [...asc].reverse(), column);
  }
});

test("Vitrina sorting is stable, non-mutating and preserves original MO names", () => {
  const before = structuredClone(rows);
  for (const column of ["name", "before", "now", "delta"]) {
    for (const direction of ["asc", "desc"]) {
      const result = sortVitrinaRows(rows, column, direction);
      assert.deepEqual([...result].map(row => row.id).sort(), rows.map(row => row.id).sort());
      for (const row of result) assert.equal(row.name, before.find(source => source.id === row.id).name);
    }
  }
  assert.deepEqual(rows, before);
  const ties = [
    { id: "z", name: "Одна МО", before: 2, now: 2, delta: 0 },
    { id: "a", name: "Одна МО", before: 2, now: 2, delta: 0 },
  ];
  assert.deepEqual(sortVitrinaRows(ties, "delta", "asc").map(row => row.id), ["a", "z"]);
});

test("Vitrina retains full source names as title and sortable registry headers", () => {
  const view = readFileSync("app/vitrina-dashboard.tsx", "utf8");
  assert.match(view, /title=\{e\.name\}/u);
  assert.match(view, /<OrganizationSignal issues=\{e\.issues\}\/>/u);
  assert.match(view, /onClick=\{\(\)=>changeSort\(h\.k\)\}/u);
  assert.match(view, /aria-sort=\{sort\.key===h\.k/);
  for (const column of ["name","now","delta","coverage","gap","issues"]) assert.ok(view.includes('k:"'+column+'"'));
});

test("Vitrina source grouping and region totals are unchanged", () => {
  const snapshots = JSON.parse(readFileSync("app/vitrina-snapshots.json", "utf8"));
  const key = value => value.toUpperCase().replace(/Ё/gu, "Е").replace(/\s+/gu, " ").trim();
  const parentKey = value => scheduleIdentity(key(value))
    .replace(/ ИМЕНИ М\.Ш\.УРАЗАЕВОЙ/u, "")
    .replace(/ Г\. НАБЕРЕЖНЫЕ ЧЕЛНЫ$/u, "")
    .replace(/ Г\. НАБЕРЕЖНЫЕ ЧЕЛНЫ(?=")/u, "")
    .replace(/"РЕСПУБЛИКАНСКАЯ СТОМАТОЛОГИЧЕСКАЯ/u, "РЕСПУБЛИКАНСКАЯ СТОМАТОЛОГИЧЕСКАЯ")
    .replace(/ПОЛИКЛИНИКА МИНИСТЕРСТВА ЗДРАВООХРАНЕНИЯ РЕСПУБЛИКИ ТАТАРСТАН"/u, "ПОЛИКЛИНИКА МИНИСТЕРСТВА ЗДРАВООХРАНЕНИЯ РЕСПУБЛИКИ ТАТАРСТАН");
  const grouped = source => {
    const map = new Map();
    for (const row of source.rows) {
      const id = parentKey(row.parent);
      const entry = map.get(id) ?? { label: row.parent, count: 0 };
      entry.count += 1;
      map.set(id, entry);
    }
    return map;
  };
  const old = grouped(snapshots.previous);
  const current = grouped(snapshots.current);
  const scope = [...new Set([...old.keys(), ...current.keys()])].map(id => ({
    id,
    name: (current.get(id) ?? old.get(id)).label,
    before: old.get(id)?.count ?? 0,
    now: current.get(id)?.count ?? 0,
  })).filter(row =>
    !/ТЕСТОВОЕ ЛПУ|НЕИЗВЕСТНАЯ МО/iu.test(row.name) &&
    /^(?:ГОСУДАРСТВЕННОЕ|ГАУЗ|ГБУЗ|ФЕДЕРАЛЬНОЕ|ФИЛИАЛ ГОСУДАРСТВЕННОГО)/iu.test(row.name),
  );
  assert.equal(scope.filter(row => row.now > 0).length, 109);
  assert.equal(scope.reduce((sum, row) => sum + row.before, 0), 624);
  assert.equal(scope.reduce((sum, row) => sum + row.now, 0), 640);
  assert.equal(scope.filter(row => row.now > row.before).length, 11);
  assert.equal(scope.filter(row => row.now < row.before).length, 1);
});
