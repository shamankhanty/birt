import { readFile, writeFile } from "node:fs/promises";

const appUrl = new URL("../app/", import.meta.url);
const metricIds = ["tvspStationary", "tvspAmbulatory", "tvspLaboratory", "tvspDiagnostic"];
const readJson = async name => JSON.parse(await readFile(new URL(name, appUrl), "utf8"));
const writeJson = async (name, value) => writeFile(new URL(name, appUrl), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const [moData, unitData, details, detailOids] = await Promise.all([
  readJson("mo-data.json"),
  readJson("unit-data.json"),
  readJson("mo-details.json"),
  readJson("mo-detail-oids.json"),
]);

for (const id of metricIds) {
  const source = unitData[id];
  const previousByOid = new Map((moData[id]?.rows ?? []).map(row => [row.oid, row]));
  const grouped = new Map();

  for (const row of source.rows) {
    const key = row.moOid || row.mo;
    const item = grouped.get(key) ?? { name: row.mo, oid: row.moOid, plan: 0, fact: 0 };
    const plan = row.plannedSubunits ?? 1;
    const fact = row.registeredSubunits ?? (row.registered && !row.partial ? plan : row.registered ? Math.max(1, plan - 1) : 0);
    item.plan += plan;
    item.fact += Math.min(fact, plan);
    grouped.set(key, item);
  }

  const rows = [...grouped.values()].map(item => {
    const previous = previousByOid.get(item.oid);
    const fact = item.plan ? item.fact / item.plan * 100 : 0;
    const previousFact = previous?.fact ?? null;
    return {
      name: item.name,
      oid: item.oid,
      fact,
      count: item.fact,
      previous: previousFact,
      trend: previousFact === null ? null : fact - previousFact,
    };
  });

  moData[id] = {
    ...moData[id],
    date: source.date,
    period: `01.01–${source.date}`,
    rows,
  };
  details[id] = Object.fromEntries([...grouped.values()].map(item => [item.name, { volume: item.plan, registered: item.fact }]));
  detailOids[id] = Object.fromEntries([...grouped.values()].filter(item => item.oid).map(item => [item.oid, { volume: item.plan, registered: item.fact }]));
}

await Promise.all([
  writeJson("mo-data.json", moData),
  writeJson("mo-details.json", details),
  writeJson("mo-detail-oids.json", detailOids),
]);

console.log(`Синхронизированы управленческие данные: ${metricIds.join(", ")}`);
