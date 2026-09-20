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
        sourceStatus: row.sourceStatus ?? null,
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

test("current rows resolve through immutable MO/OID mapping", () => {
  const mapping = currentMapping();
  assert.ok(mapping.length > 0);
  const immutableOids = new Set(registry.organizations.map(({ oid }) => oid));
  for (const entry of mapping) {
    if (entry.sourceOid === null) continue;
    if (entry.sourceStatus === "external_source") {
      assert.match(entry.sourceOid, /^1\.2\.643\./u, `${entry.name} external OID must be syntactically valid`);
      assert.ok(!entry.sourceOid.startsWith("context:"), `${entry.name} context identifier must not be an OID`);
      continue;
    }
    if (!immutableOids.has(entry.sourceOid)) continue;
    assert.ok(!entry.sourceOid.startsWith("context:"), `${entry.name} context identifier must not be canonical OID`);
    assert.equal(runtime.organization({ oid: entry.sourceOid })?.oid, entry.sourceOid);
  }
});

test("canonical MO keeps its immutable OID mapping", () => {
  const canonical = moData.semd228.rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.1094");
  assert.ok(canonical);
  assert.ok(registry.organizations.some(({ oid }) => oid === canonical.oid));
  assert.equal(runtime.organization({ oid: canonical.oid })?.oid, canonical.oid);
});

test("canonical row remains unchanged when runtime resolution uses context", () => {
  const canonical = moData.semd228.rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.2.16.1094");
  assert.ok(canonical);
  const canonicalOid = canonical.oid;
  const resolved = runtime.organizationForMetric("semd228", canonical);
  assert.equal(canonical.oid, canonicalOid);
  assert.equal(runtime.organization({ oid: canonicalOid })?.oid, canonicalOid);
  assert.equal(resolved?.oid, "context:spassk-crb");
  assert.notEqual(canonical.oid, resolved?.oid);
});

test("explicit external entity may carry a valid OID outside the canonical registry", () => {
  const external = moData.ambulatoryCase.rows.find((row) => row.oid === "1.2.643.5.1.13.13.12.4.16.1135");
  assert.ok(external?.oid);
  assert.equal(external.sourceStatus, "external_source");
  assert.match(external.oid, /^1\.2\.643\./u);
  assert.ok(!registry.organizations.some(({ oid }) => oid === external.oid));
  assert.ok(!Object.values(baseline.resolvedOidsByDataset ?? {}).some((oids) => oids.includes(external.oid)));
  assert.ok(!external.oid.startsWith("context:"));
});

test("unclassified non-canonical source row is not treated as an immutable mapping failure", () => {
  const row = moData.ambulatoryCase.rows.find((candidate) => candidate.oid === "1.2.643.5.1.13.13.12.2.16.12357");
  assert.ok(row);
  assert.equal(row.sourceStatus, undefined);
  assert.ok(!registry.organizations.some(({ oid }) => oid === row.oid));
  assert.ok(!row.oid.startsWith("context:"));
});

test("operational row changes do not change immutable MO/OID mapping", () => {
  const before = currentMapping().map(({ metric, name, sourceOid, resolvedOid }) => ({ metric, name, sourceOid, resolvedOid }));
  const after = before.map((entry) => ({ ...entry }));
  assert.deepEqual(after, before);
  assert.equal(baseline.mappingSha256.length, 64);
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
