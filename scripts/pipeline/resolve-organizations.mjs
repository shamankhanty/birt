import fs from 'node:fs';
import { createMoRegistryRuntime } from '../../lib/mo-registry.js';
const { metric, rows, registry, sourceReport } = JSON.parse(fs.readFileSync(0, 'utf8'));
const runtime = createMoRegistryRuntime(registry);
console.log(JSON.stringify(rows.map(row => {
  if (sourceReport && !row.sourceReport) row = { ...row, sourceReport };
  const org = runtime.organizationForMetric(metric, row);
  if (!org && (row.spOid || row.subunitOid || row.buildingId || row['OID СП МО'] || row['ID здания'])) {
    throw new Error('Не подтверждена принадлежность подразделения или здания медицинской организации');
  }
  if (org?.oid === 'context:spassk-crb') {
    return { ...row, name: org.shortName, reportingEntityId: org.oid,
      parentOid: '1.2.643.5.1.13.13.12.2.16.1094' };
  }
  return org ? { ...row, oid: org.oid, name: org.shortName || org.name } : row;
})));
