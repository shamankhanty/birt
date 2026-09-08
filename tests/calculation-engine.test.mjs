import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  aggregateComponents,
  aggregateQuantityPairs,
  createIndicatorCalculationRuntime,
  parseQuantityPair,
  passedPlan,
  scoreAgainstPlan,
} from "../lib/calculation-engine.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const semantic = read("baseline/semantic-snapshot.json");
const runtimeSnapshot = read("baseline/calculation-runtime-snapshot.json");
const physicianMetrics = read("app/physician-metrics.json");
const moDetails = read("app/mo-details.json");
const moDetailOids = read("app/mo-detail-oids.json");
const preventiveSemdAudit = read("app/preventive-semd-audit.json");
const monthlyMo = read("app/monthly-mo.json");
const moData = {
  ...read("app/mo-data.json"),
  ...read("app/operational-mo.json"),
  ...read("app/organization-status.json"),
  ...physicianMetrics.datasets,
};
const registry = read("config/indicator-registry.json");

const sourceBackedIds = new Set(["egpu", "egpu2days", "birth", "death", "semd228", "hospital", "ambulatoryCase", "smp"]);
function isTechnicalRow(name) {
  return /^\s*(?:итого|всего по|неизвестная МО)/iu.test(name);
}
function isExcludedFromIndicators(name) {
  const normalized = String(name ?? "").replace(/[«»"']/g, " ").replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
  return (
    /(?:^|\s)КГМА(?=\s|$).*?(?:^|\s)РМАНПО(?=\s|$)/iu.test(normalized) ||
    /(?:^|\s)[АР]ЦОЗ\s+и\s+МП(?:\s|$)/iu.test(normalized) ||
    /(?:^|\s)Казанск(?:ий|ого)\s+ГМУ(?=\s|$).*?(?:^|\s)Минздрава\s+России/iu.test(normalized)
  );
}
function isMaxProfileInapplicable(name) {
  return /ркпд|противотуберкул|(?:^|\s)птд(?:\s|$)/iu.test(String(name ?? "").toLocaleLowerCase("ru"));
}
const includeDatasetRow = (id, row) =>
  !isTechnicalRow(row.name) && !isExcludedFromIndicators(row.name) &&
  (!(id === "tmkMaxCount" || id === "elnMaxCount") || !isMaxProfileInapplicable(row.name));

const sourceQuantityNouns = {
  egpu: "поданных заявлений",
  egpu2days: "поданных заявлений",
  birth: "свидетельств",
  death: "свидетельств",
  semd228: "обращений",
  hospital: "случаев",
  ambulatoryCase: "амбулаторных случаев",
  smp: "карт вызова",
};
const staticIndicators = Object.entries(semantic.regionalCards).map(([id, card]) => ({
  id,
  group: "snapshot",
  name: id,
  fact: card.fact,
  plan: card.plan,
  unit: ["tmkMax", "elnMax", "visitMax"].includes(id) ? "" : "%",
  trend: null,
  date: card.date,
  lag: null,
  reverse: card.direction === "lower",
}));

function legacyRuntime() {
  const physician = Object.entries(physicianMetrics.datasets).map(([id, dataset]) => ({
    id,
    fact: dataset.summary.fact,
    plan: dataset.plan,
    date: dataset.date,
    quantity: dataset.summary.numerator,
    lag: Math.max(0, Math.ceil(dataset.summary.denominator * (dataset.plan ?? 0) / 100) - dataset.summary.numerator),
  }));
  return Object.fromEntries([...staticIndicators, ...physician].map((indicator) => {
    if (indicator.id === "elmk" || indicator.id === "tmkRemd") {
      const dataset = moData[indicator.id];
      if (dataset?.rows.length) {
        const quantity = dataset.rows.filter((row) => row.fact > 0).length;
        const volume = dataset.rows.length;
        return [indicator.id, { ...indicator, fact: (quantity / volume) * 100, quantity, lag: volume - quantity, date: dataset.date }];
      }
    }
    if (sourceBackedIds.has(indicator.id)) {
      const details = Object.values(moDetails[indicator.id] ?? {});
      const dataset = moData[indicator.id];
      if (details.length && dataset) {
        const quantity = details.reduce((sum, row) => sum + row.registered, 0);
        const volume = details.reduce((sum, row) => sum + row.volume, 0);
        return [indicator.id, { ...indicator, fact: volume ? (quantity / volume) * 100 : 0, quantity, lag: volume - quantity, date: dataset.date }];
      }
    }
    return [indicator.id, indicator];
  }));
}

const runtime = createIndicatorCalculationRuntime({
  staticIndicators,
  physicianMetrics,
  moData,
  moDetails,
  moDetailOids,
  preventiveSemdAudit,
  preventiveChildOids: new Set(preventiveSemdAudit.rows.filter((row) => row.child).map((row) => row.oid)),
  blockedIndicatorIds: new Set(),
  sourceBackedIndicatorIds: sourceBackedIds,
  sourceQuantityNouns,
  reportingLabel: "август 2026",
  includeDatasetRow,
});

test("calculation runtime reproduces every pre-stage5 regional/physician runtime value", () => {
  const legacy = legacyRuntime();
  assert.equal(Object.keys(runtime.byId).length, Object.keys(legacy).length);
  for (const [id, expected] of Object.entries(legacy)) {
    const actual = runtime.byId[id];
    assert.ok(actual, `missing ${id}`);
    assert.equal(actual.fact, expected.fact, `fact drift ${id}`);
    assert.equal(actual.plan, expected.plan, `plan drift ${id}`);
    assert.equal(actual.date, expected.date, `date drift ${id}`);
    assert.equal(actual.quantity ?? null, expected.quantity ?? null, `quantity drift ${id}`);
    assert.equal(actual.lag ?? null, expected.lag ?? null, `lag drift ${id}`);
  }
});

test("frozen runtime snapshot matches the calculation layer exactly", () => {
  for (const [id, expected] of Object.entries(runtimeSnapshot.regional)) {
    const actual = runtime.byId[id];
    assert.equal(actual.fact, expected.fact, `regional fact ${id}`);
    assert.equal(actual.date, expected.date, `regional date ${id}`);
    assert.equal(actual.calculation?.method ?? null, expected.method, `method ${id}`);
  }
  for (const [id, expected] of Object.entries(runtimeSnapshot.physician)) {
    const actual = runtime.byId[id];
    assert.equal(actual.fact, expected.fact, `physician fact ${id}`);
    assert.equal(actual.calculation?.numerator, expected.numerator, `physician numerator ${id}`);
    assert.equal(actual.calculation?.denominator, expected.denominator, `physician denominator ${id}`);
  }
});

test("single calculation map covers all 38 registry indicators", () => {
  assert.equal(Object.keys(runtime.allById).length, 38);
  assert.deepEqual(Object.keys(runtime.allById).sort(), Object.keys(registry.indicators).sort());
  for (const [id, expected] of Object.entries(runtimeSnapshot.allIndicators)) {
    const actual = runtime.allById[id];
    assert.ok(actual, `missing ${id}`);
    assert.equal(actual.fact, expected.fact, `fact ${id}`);
    assert.equal(actual.plan ?? null, expected.plan ?? null, `plan ${id}`);
    assert.equal(actual.date ?? null, expected.date ?? null, `date ${id}`);
    assert.equal(actual.previous ?? null, expected.previous ?? null, `previous ${id}`);
    assert.equal(actual.trend ?? null, expected.trend ?? null, `trend ${id}`);
  }
});

test("dataset-only count indicators reproduce the pre-stage5 filtered sums", () => {
  const ids = ["tmkMaxCount", "elnMaxCount", "shortInput", "hospitalCount", "fapSemdCount", "shortInputAmb", "shortInputHosp"];
  for (const id of ids) {
    const rows = moData[id].rows.filter((row) => includeDatasetRow(id, row));
    const expectedFact = rows.reduce((sum, row) => sum + (Number(row.fact) || 0), 0);
    const expectedPrevious = rows.reduce((sum, row) => sum + (Number(row.previous) || 0), 0);
    assert.equal(runtime.allById[id].fact, expectedFact, id);
    assert.equal(runtime.allById[id].previous, expectedPrevious, id);
  }
});

test("component aggregation is mathematically identical to the legacy reduce formula", () => {
  for (const id of sourceBackedIds) {
    const rows = Object.values(moDetails[id] ?? {});
    const expectedNumerator = rows.reduce((sum, row) => sum + row.registered, 0);
    const expectedDenominator = rows.reduce((sum, row) => sum + row.volume, 0);
    const actual = aggregateComponents(rows);
    assert.equal(actual.numerator, expectedNumerator, id);
    assert.equal(actual.denominator, expectedDenominator, id);
    assert.equal(actual.fact, expectedDenominator ? expectedNumerator / expectedDenominator * 100 : 0, id);
  }
});

test("rating score and pass helpers reproduce legacy formulas for all active monthly rows", () => {
  for (const id of semantic.rating.activeMetricIds) {
    const dataset = monthlyMo[id];
    const plan = moData[id]?.plan;
    if (!dataset || plan === null || plan === undefined) continue;
    const direction = moData[id]?.direction ?? "higher";
    for (const row of dataset.rows) {
      if (row.july === null) continue;
      const legacy = direction === "lower"
        ? row.july <= 0 ? 100 : Math.max(0, Math.min((plan / row.july) * 100, 100))
        : Math.max(0, Math.min((row.july / plan) * 100, 100));
      assert.equal(scoreAgainstPlan({ fact: row.july, plan, direction }), legacy, `${id}:${row.name}`);
      assert.equal(passedPlan({ fact: row.july, plan, direction }), direction === "lower" ? row.july <= plan : row.july >= plan, `${id}:${row.name}`);
    }
  }
});

test("quantity parser and aggregate reproduce legacy monthly component extraction", () => {
  for (const id of semantic.rating.activeMetricIds) {
    const rows = monthlyMo[id]?.rows ?? [];
    for (const field of ["juneQuantity", "julyQuantity"]) {
      let n = 0, d = 0, parsed = 0;
      for (const row of rows) {
        const match = String(row[field] ?? "").match(/([\d\s]+)\s*(?:\/|из)\s*([\d\s]+)/i);
        if (!match) continue;
        n += Number(match[1].replace(/\s/g, ""));
        d += Number(match[2].replace(/\s/g, ""));
        parsed += 1;
        assert.deepEqual(parseQuantityPair(row[field]), {
          numerator: Number(match[1].replace(/\s/g, "")),
          denominator: Number(match[2].replace(/\s/g, "")),
        });
      }
      assert.deepEqual(aggregateQuantityPairs(rows, field), {
        numerator: n,
        denominator: d,
        fact: d ? n / d * 100 : 0,
        parsed,
      });
    }
  }
});

test("approved runtime snapshot has no unresolved static/runtime divergences", () => {
  assert.deepEqual(
    runtimeSnapshot.approvedStaticVsRuntimeDivergences.map((row) => row.id),
    [],
  );
  for (const row of runtimeSnapshot.approvedStaticVsRuntimeDivergences) {
    assert.notEqual(row.roundedApproved, row.roundedRuntime);
  }
});

test("indicator registry still covers every calculation-layer id", () => {
  for (const id of Object.keys(runtime.byId)) {
    assert.ok(registry.indicators[id], `registry missing ${id}`);
  }
});

test("page runtime uses the single calculation layer instead of the removed duplicate regional block", () => {
  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.match(page, /createIndicatorCalculationRuntime\(/);
  assert.match(page, /const calculatedIndicatorById = calculationRuntime\.allById/);
  assert.doesNotMatch(page, /const physicianIndicators: Indicator\[]/);
  assert.doesNotMatch(page, /liveIndicators\.find\(/);
  assert.doesNotMatch(page, /details\.reduce\(\(sum, row\) => sum \+ row\.registered/);
});
