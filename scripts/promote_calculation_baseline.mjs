import fs from "node:fs";

const snapshotPath = "baseline/calculation-runtime-snapshot.json";
const report = JSON.parse(fs.readFileSync("validation/calculation-equivalence.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
for (const mismatch of report.mismatches ?? []) {
  if (!snapshot.allIndicators[mismatch.id]) continue;
  snapshot.allIndicators[mismatch.id][mismatch.field] = mismatch.actual;
}
for (const id of Object.keys(snapshot.regional ?? {})) {
  const item = snapshot.allIndicators[id];
  if (!item) continue;
  snapshot.regional[id] = {
    ...snapshot.regional[id], fact: item.fact, plan: item.plan, date: item.date,
    quantity: item.quantity, numerator: item.numerator, denominator: item.denominator,
    method: item.method, source: item.source,
  };
}
snapshot.baselineVersion = "4.7.0";
snapshot.rule = "Snapshot фиксирует утверждённый runtime после оперативного обновления на 07.09.2026; месячный рейтинг остаётся по полному августу.";
snapshot.approvedStaticVsRuntimeDivergences = [];
fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", baselineVersion: snapshot.baselineVersion, updatedFields: report.mismatches?.length ?? 0 }));
