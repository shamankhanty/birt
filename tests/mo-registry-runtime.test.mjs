import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  cleanMoName,
  createMoRegistryRuntime,
  findDroppedOrganizations,
  moKey,
  SPASSK_CRB_ORGANIZATION,
} from "../lib/mo-registry.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const registry = readJson("app/mo-registry.json");
const moData = readJson("app/mo-data.json");
const monthlyMo = readJson("app/monthly-mo.json");
const baseline = readJson("baseline/mo-registry-runtime-snapshot.json");
const runtime = createMoRegistryRuntime(registry);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function currentMapping() {
  const entries = [];
  for (const [metric, dataset] of Object.entries(moData)) {
    for (const row of dataset.rows ?? []) {
      entries.push({
        scope: "mo-data",
        metric,
        name: row.name,
        sourceOid: row.oid ?? null,
        cleanName: cleanMoName(row.name),
        resolvedOid: runtime.organizationForMetric(metric, row)?.oid ?? null,
      });
    }
  }
  for (const [metric, dataset] of Object.entries(monthlyMo)) {
    for (const row of dataset.rows ?? []) {
      entries.push({
        scope: "monthly-mo",
        metric,
        name: row.name,
        sourceOid: null,
        cleanName: cleanMoName(row.name),
        resolvedOid: runtime.organizationByMetricAndName(metric, row.name)?.oid ?? null,
      });
    }
  }
  entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "ru"));
  return entries;
}

function numberTokens(value) {
  return [...String(value).matchAll(/№\s*(\d+)/gu)].map((match) => match[1]);
}

test("central MO runtime is byte-equivalent to v4.6.0 linkage behavior", () => {
  const mapping = currentMapping();
  assert.equal(mapping.length, baseline.entryCount);
  assert.equal(mapping.filter((entry) => entry.resolvedOid !== null).length, baseline.resolvedCount);
  assert.equal(sha256(JSON.stringify(mapping)), baseline.mappingSha256);
});

test("registry OIDs are unique and every master organization resolves by OID", () => {
  assert.equal(runtime.byOid.size, registry.organizations.length);
  assert.equal(runtime.byOid.size, 127);
  for (const organization of registry.organizations) {
    assert.equal(runtime.organization({ name: "ignored", oid: organization.oid })?.oid, organization.oid);
  }
});

test("numbered facilities never inherit an alias with another number", () => {
  const conflicts = [];
  for (const organization of registry.organizations) {
    const target = new Set(numberTokens(`${organization.name} ${organization.shortName}`));
    for (const alias of organization.aliases) {
      const source = new Set(numberTokens(alias));
      if (source.size && target.size && [...source].some((number) => !target.has(number))) {
        conflicts.push({ oid: organization.oid, alias });
      }
    }
  }
  assert.deepEqual(conflicts, []);
});

test("ambiguous city-free aliases are never guessed", () => {
  const ambiguousExact = [...runtime.aliasCandidates.entries()].filter(([, organizations]) => organizations.length > 1);
  assert.ok(ambiguousExact.length > 0);
  for (const [key] of ambiguousExact) {
    assert.equal(runtime.organizationByName(key), null, `ambiguous key must not resolve: ${key}`);
  }
});

test("Kazan and Naberezhnye Chelny numbered pediatric clinics stay separate", () => {
  const kazan = runtime.organizationByName('ГАУЗ "Городская детская поликлиника №6" г.Казани');
  const chelny = runtime.organizationByName('ГАУЗ "Детская городская поликлиника №6" г.Наб.Челны');
  assert.equal(kazan?.oid, "1.2.643.5.1.13.13.12.2.16.1090");
  assert.equal(chelny?.oid, "1.2.643.5.1.13.13.12.2.16.1066");
  assert.notEqual(kazan?.oid, chelny?.oid);
  assert.equal(runtime.organizationByName("ДГП №6"), null);
});

test("approved contextual RKB/Spassk rule is unchanged", () => {
  assert.equal(runtime.organizationByMetricAndName("egpu", "РКБ")?.oid, SPASSK_CRB_ORGANIZATION.oid);
  assert.equal(
    runtime.organizationForMetric("birth", { name: "РКБ", oid: "1.2.643.5.1.13.13.12.2.16.1094" })?.oid,
    "1.2.643.5.1.13.13.12.2.16.1094",
  );
});

test("dropped-MO guard detects disappearance between comparable datasets", () => {
  const rows = moData.tvspStationary.rows;
  const target = rows.find((row) => row.oid && runtime.byOid.has(row.oid));
  assert.ok(target?.oid);
  const current = rows.filter((row) => row.oid !== target.oid);
  const dropped = findDroppedOrganizations(runtime, "tvspStationary", rows, current);
  assert.ok(dropped.some((organization) => organization.oid === target.oid));
});

test("page runtime no longer contains a second MO alias index implementation", () => {
  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.match(page, /createMoRegistryRuntime\(moRegistry\)/u);
  assert.doesNotMatch(page, /registryAliasCandidates/u);
  assert.doesNotMatch(page, /function\s+cleanMoName/u);
  assert.doesNotMatch(page, /function\s+ratingCoreKey/u);
  assert.equal(moKey("ГБ №11"), moKey("ГБ №11, Казань"));
});
