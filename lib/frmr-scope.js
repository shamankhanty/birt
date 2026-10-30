/** Approved applicability exceptions for the current FRMR ↔ GIS control scope.
 * Source extracts and historical snapshots remain unchanged.
 */
export function frmrExclusionReason(role, department) {
  const r = role.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const d = department.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  if (r === 'врач-стажер') return 'trainee';
  if (['медицинский лабораторный техник', 'старший фельдшер-лаборант'].includes(r)) return 'laboratory';
  // Do not confuse emergency outpatient offices with ambulance services.
  if (r === 'фельдшер скорой медицинской помощи' || /скорой\s+(?:и\s+неотложной\s+)?(?:медицинской\s+)?помощи|скорая медицинская помощь|скорая помощь|(?:^|[ (])осмп(?:$|[ )-])/u.test(d)) return 'ambulance';
  return null;
}
export function applyFrmrScope(source) {
  const excluded = { ambulance: 0, trainee: 0, laboratory: 0, total: 0 };
  const records = source.records.rows.filter(row => {
    const reason = frmrExclusionReason(source.departments.roles[row[1]], source.departments.sp[row[2]][2]);
    if (reason) { excluded[reason]++; excluded.total++; return false; }
    return true;
  });
  const orgs = new Map(), groups = new Map(), specialties = new Map();
  for (const row of records) {
    const [mo, role, sp,, issue] = row;
    const org = orgs.get(mo) ?? { stages: [0, 0], roles: new Map() };
    org.stages[issue]++; org.roles.set(role, (org.roles.get(role) ?? 0) + 1); orgs.set(mo, org);
    const key = [mo, role, sp].join(':');
    const group = groups.get(key) ?? [mo, role, sp, 0, 0]; group[3 + issue]++; groups.set(key, group);
    specialties.set(role, (specialties.get(role) ?? 0) + 1);
  }
  const names = counts => [...counts].map(([i, n]) => [source.departments.roles[i], n]).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'ru'));
  const rows = source.summary.rows.map(row => {
    const org = orgs.get(source.departments.mos.indexOf(row[0]));
    return [...row.slice(0,4), org ? org.stages[0]+org.stages[1] : 0, org?.stages[0] ?? 0, org?.stages[1] ?? 0, row[7], org ? names(org.roles) : []];
  });
  return { excluded, data: { ...source,
    summary: { ...source.summary, rows, topSpecialties: names(specialties), trend: [[source.summary.sourceCut, records.length]] },
    departments: { ...source.departments, rows: [...groups.values()] },
    records: { ...source.records, rows: records },
  } };
}
