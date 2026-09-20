import fs from 'node:fs';
import { createMoRegistryRuntime } from '../../lib/mo-registry.js';
const { metric, rows, registry } = JSON.parse(fs.readFileSync(0, 'utf8'));
const runtime = createMoRegistryRuntime(registry);
console.log(JSON.stringify(rows.map(row => {
  const org = runtime.organizationForMetric(metric, row);
  return org ? { ...row, oid: org.oid, name: org.shortName || org.name } : row;
})));
