import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const targets = JSON.parse(fs.readFileSync("config/max-targets-2026.json", "utf8"));
const page = fs.readFileSync("app/page.tsx", "utf8");

test("MAX target documents preserve separate RT plans and MO control points", () => {
  assert.deepEqual(targets.months, ["2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(targets.republic.tmk, { "2026-09": 145000, "2026-10": 161000, "2026-11": 177000, "2026-12": 193000 });
  assert.deepEqual(targets.republic.eln, { "2026-09": 74000, "2026-10": 82000, "2026-11": 90000, "2026-12": 99000 });
  assert.equal(targets.validation.sourceOrganizationRows, 85);
  assert.equal(targets.validation.matchedOrganizations, 85);
  assert.equal(targets.validation.ambiguous, 0);
  assert.equal(targets.validation.unmatched, 0);
  assert.equal(targets.validation.duplicateOidCollisions, 0);
  assert.equal(targets.validation.noRedistribution, true);
  assert.equal(Object.keys(targets.organizationPlans).length, 85);
  assert.ok(Object.values(targets.organizationPlans).every((row) => row.oid && Object.keys(row.tmk).length === 4 && Object.keys(row.eln).length === 4));
  assert.match(page, /max-targets-2026\.json/u);
  assert.match(page, /data-testid="max-plan-summary"/u);
  assert.match(page, /data-testid="max-plan-organization-table"/u);
  assert.match(page, /maxDashboardServiceKey/u);
  assert.match(page, /maxDashboardFact/u);
  assert.match(page, /maxDashboardAchievement/u);
  assert.match(page, /maxDashboardRemaining/u);
  assert.match(page, /maxDashboardRequiredPace/u);
  assert.match(page, /План требует контроля/u);
  assert.match(page, /Следующая контрольная точка/u);
});

test("MAX approved source rows keep exact OIDs and Sep-Dec control points", () => {
  const expected = {
    "1153": [[1358, 1508, 1658, 1808], [693, 768, 843, 927]],
    "1115": [[2935, 3258, 3582, 3906], [1498, 1660, 1821, 2004]],
    "1113": [[1186, 1316, 1447, 1578], [605, 671, 736, 810]],
    "1090": [[1896, 2106, 2315, 2524], [968, 1072, 1177, 1295]],
    "1066": [[705, 783, 861, 939], [360, 399, 438, 482]],
    "1067": [[808, 897, 986, 1075], [412, 457, 501, 552]],
    "1127": [[998, 1108, 1218, 1328], [509, 564, 619, 681]],
    "1165": [[807, 897, 986, 1075], [412, 457, 501, 551]],
    "1171": [[2199, 2442, 2684, 2927], [1122, 1244, 1365, 1501]],
    "1146": [[1679, 1864, 2049, 2235], [857, 949, 1042, 1146]],
    "1093": [[3213, 3568, 3922, 4277], [1640, 1817, 1994, 2194]],
    "1131": [[395, 439, 482, 526], [202, 223, 245, 270]],
    "18650": [[594, 659, 725, 790], [303, 336, 368, 405]],
    "1155": [[1607, 1784, 1961, 2139], [820, 909, 997, 1097]],
  };
  const values = (row, metric) => targets.months.map((month) => row[metric][month]);
  for (const [suffix, [tmk, eln]] of Object.entries(expected)) {
    const oid = `1.2.643.5.1.13.13.12.2.16.${suffix}`;
    assert.deepEqual(values(targets.organizationPlans[oid], "tmk"), tmk, `${oid} TMK`);
    assert.deepEqual(values(targets.organizationPlans[oid], "eln"), eln, `${oid} ELN`);
  }
});

test("MAX target calculations never use a combined TMK plus ELN value", () => {
  assert.match(page, /maxDashboardMetric = maxService === "tmk" \? "tmkMaxCount" : "elnMaxCount"/u);
  assert.match(page, /maxDashboardServiceKey = maxService === "tmk" \? "tmk" : "eln"/u);
  assert.doesNotMatch(page, /tmk.*\+.*eln|eln.*\+.*tmk/u);
});
