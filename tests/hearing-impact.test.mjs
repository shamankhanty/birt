import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const policy = JSON.parse(await readFile(new URL("../app/hearing-priority-policy.json", import.meta.url), "utf8"));

test("operational hearing priority uses deficit shares and capped block weights", () => {
  assert.match(source, /targetCount = \(metric\.plan \/ 100\) \* metric\.volume/);
  assert.match(source, /deficitCount = Math\.max\(0, targetCount - metric\.count\)/);
  assert.match(source, /deficitShare = \(\(metric\.deficitCount \?\? 0\) \/ regionalDeficit\) \* 100/);
  assert.match(source, /impactNormalized \* hearingPriorityPolicy\.scoreWeights\.impact/);
  assert.deepEqual(Object.fromEntries(Object.entries(policy.blocks).map(([id, block]) => [id, block.weight])), {
    care: 0.7, services: 0.2, readiness: 0.1,
  });
  for (const block of Object.values(policy.blocks))
    assert.ok(Math.abs(Object.values(block.metrics).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(Math.abs(Object.values(policy.scoreWeights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.deepEqual(policy.mandatory, {
    impactRank: 5,
    extendedImpactRank: 10,
    persistentFailures: 2,
    failedBlocks: 3,
    missingMetrics: 2,
  });
});

test("full MO profile preserves management statuses", () => {
  for (const label of ["Влияет на оперативный приоритет", "Месячный контроль", "Справочно", "Нет данных", "Неприменимо"])
    assert.match(source, new RegExp(label));
  assert.match(source, /Object\.keys\(moData\)\.forEach/);
});

test("REMD errors and KDL do not enter the influence calculation", () => {
  assert.match(source, /id: "remd-registration-errors"/);
  assert.match(source, /affectsPriority: false/);
  assert.match(source, /isOperationalHearingMetric\(metric\.id\)/);
});

test("500 plus is isolated from operational priority", () => {
  assert.ok(policy.monthlyWorkforce.prefixes.includes("doctor500_"));
  assert.ok(policy.monthlyWorkforce.partialPrefixes.includes("operational500_"));
  assert.match(source, /id: `operational500_\$\{id\}`/);
  assert.match(source, /В месячный рейтинг не включается/);
  assert.match(source, /affectsPriority: false/);
  assert.match(source, /hearingQueue === "monthly"/);
});
