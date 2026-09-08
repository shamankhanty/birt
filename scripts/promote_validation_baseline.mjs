import fs from "node:fs";
import { createValidationSnapshot } from "../lib/validation-engine.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const snapshot = createValidationSnapshot({
  indicatorRegistry: read("config/indicator-registry.json"),
  moRegistry: read("app/mo-registry.json"),
  moData: read("app/mo-data.json"),
  monthlyMo: read("app/monthly-mo.json"),
  operationalMo: read("app/operational-mo.json"),
  organizationStatus: read("app/organization-status.json"),
  physicianMetrics: read("app/physician-metrics.json"),
});
fs.writeFileSync("baseline/validation-snapshot.json", `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", baselineVersion: snapshot.baselineVersion, acknowledgedCounts: snapshot.acknowledgedCounts }));
