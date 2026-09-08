import crypto from "node:crypto";
import fs from "node:fs";
import { cleanMoName, createMoRegistryRuntime } from "../lib/mo-registry.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const registry = read("app/mo-registry.json");
const runtime = createMoRegistryRuntime(registry);
const entries = [];
for (const [metric, dataset] of Object.entries(read("app/mo-data.json"))) {
  for (const row of dataset.rows ?? []) entries.push({ scope: "mo-data", metric, name: row.name, sourceOid: row.oid ?? null, cleanName: cleanMoName(row.name), resolvedOid: runtime.organizationForMetric(metric, row)?.oid ?? null });
}
for (const [metric, dataset] of Object.entries(read("app/monthly-mo.json"))) {
  for (const row of dataset.rows ?? []) entries.push({ scope: "monthly-mo", metric, name: row.name, sourceOid: null, cleanName: cleanMoName(row.name), resolvedOid: runtime.organizationByMetricAndName(metric, row.name)?.oid ?? null });
}
entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "ru"));
const payload = {
  schemaVersion: 1, baselineVersion: "4.7.0", entryCount: entries.length,
  resolvedCount: entries.filter((entry) => entry.resolvedOid !== null).length,
  mappingSha256: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
};
fs.writeFileSync("baseline/mo-registry-runtime-snapshot.json", `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", ...payload }));
