import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const federal = JSON.parse(await readFile(new URL("../app/federal-control.json", import.meta.url), "utf8"));
const rows = new Map(federal.agreement.map((row) => [row.id, row]));

const expected = new Map([
  ["1.1", "99%"],
  ["20", "92,73%"],
  ["25", "55,76%"],
  ["26", "99%"],
  ["34", "98%"],
  ["36", "99%"],
]);

test("new non-empty regional facts use the September 2026 period", () => {
  for (const [id, value] of expected) {
    const row = rows.get(id);
    assert.equal(row?.regionalFact, value, `indicator ${id}`);
    assert.equal(row?.regionalPeriod, "январь–сентябрь 2026", `indicator ${id}`);
    assert.match(row?.sourceNote ?? "", /числитель и знаменатель не представлены/iu, `indicator ${id}`);
  }
});

test("EPGU and REMD error shares use 21 October cuts, independently of September source", () => {
  for (const [id, fact] of [["18", "21,34%"], ["29", "16,62%"]]) {
    const row = rows.get(id);
    assert.equal(row?.regionalFact, fact, `indicator ${id}`);
    assert.equal(row?.regionalPeriod, "01.01.2026–21.10.2026", `indicator ${id}`);
    assert.match(row?.sourceNote ?? "", /без первичной регулярной выгрузки|Первичная регулярная выгрузка/u, `indicator ${id}`);
    assert.equal(row?.status, "Отклонение", `indicator ${id}`);
  }
});

test("blank September cells do not overwrite previously confirmed values", () => {
  assert.equal(rows.get("19")?.regionalFact, "Нет");
  assert.equal(rows.get("19")?.regionalPeriod, "01.01–06.09.2026");
  assert.equal(rows.get("22")?.regionalFact, "959 973 из 6 653 066 · 14,43%");
  assert.equal(rows.get("24")?.regionalFact, "35 из 35 · 100%");
});

test("September statuses follow each indicator direction and plan", () => {
  assert.equal(rows.get("18")?.status, "Отклонение");
  assert.equal(rows.get("20")?.status, "Достигнут");
  assert.equal(rows.get("26")?.status, "Достигнут");
  assert.equal(rows.get("29")?.status, "Отклонение");
});
