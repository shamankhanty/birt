import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const data = JSON.parse(
  fs.readFileSync(new URL("../app/gis-oms-organizations.json", import.meta.url), "utf8"),
);
const federal = JSON.parse(
  fs.readFileSync(new URL("../app/federal-control.json", import.meta.url), "utf8"),
);
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const gisOmsPage = fs.readFileSync(
  new URL("../public/gis-oms-2026-q3.html", import.meta.url),
  "utf8",
);
const publicData = JSON.parse(
  fs.readFileSync(new URL("../public/gis-oms-organizations.json", import.meta.url), "utf8"),
);

test("GIS OMS drilldowns preserve federal Татарстан denominators and facts", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(data.indicators).map(([id, indicator]) => [
        id,
        [indicator.numerator, indicator.denominator],
      ]),
    ),
    {
      "1.2": [0, 104],
      "1.2.1": [0, 104],
      "1.2.2": [1, 83],
      "1.2.3": [0, 104],
    },
  );

  for (const indicator of Object.values(data.indicators)) {
    assert.equal(indicator.rows.length, indicator.denominator);
    assert.equal(
      indicator.rows.filter((organization) => organization.achieved).length,
      indicator.numerator,
    );
    assert.equal(new Set(indicator.rows.map((organization) => organization.oid)).size, indicator.denominator);
  }
});

test("attachment component identifies the only achieved organization", () => {
  const achieved = data.indicators["1.2.2"].rows.filter((organization) => organization.achieved);
  assert.deepEqual(
    achieved.map(({ oid, name, volume }) => ({ oid, name, volume })),
    [
      {
        oid: "1.2.643.5.1.13.13.12.2.16.1163",
        name: 'ГАУЗ "ГКБ№7 ИМ. М.Н.САДЫКОВА"',
        volume: 1,
      },
    ],
  );
});

test("federal rows and UI expose the organization lists", () => {
  const rows = Object.fromEntries(federal.agreement.map((row) => [row.id, row]));
  assert.equal(rows["1.2.2"].regionalFact, "1 из 83 · 1,2%");
  assert.match(page, /gisOmsOrganizations\.indicators\[row\.id\]/);
  assert.match(page, /Не исполнено:/);
  assert.match(page, /Исполнено/);
});

test("dedicated GIS OMS page loads the verified organization drilldown", () => {
  assert.deepEqual(publicData, data);
  assert.doesNotMatch(gisOmsPage, /Детализация ожидает верифицированной загрузки/);
  assert.match(gisOmsPage, /fetch\('\.\/gis-oms-organizations\.json'\)/);
  assert.match(gisOmsPage, /Не исполнено прикрепление/);
  assert.match(gisOmsPage, /Показано/);
});
