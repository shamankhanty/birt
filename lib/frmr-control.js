/** One source record belongs to exactly one control level. Never sum SP references into MO control. */
export function frmrControlView(source, level = 'mo', type = '', types = {}) {
  if (!['mo', 'department'].includes(level)) throw new Error('Unknown FRMR control level');
  const stage = level === 'mo' ? 0 : 1;
  const records = source.records.rows.filter(r => {
    const [mo, suffix] = source.departments.sp[r[2]];
    const oid = '1.2.643.5.1.13.13.12.2.16.' + source.departments.mos[mo] + '.0.' + suffix;
    return r[4] === stage && (!type || (types[oid] || 'Не указан') === type);
  });
  const orgs = new Map(), groups = new Map(), roles = new Map();
  for (const r of records) {
    const [mo, role, sp] = r;
    const org = orgs.get(mo) ?? { count: 0, roles: new Map() };
    org.count++;org.roles.set(role,(org.roles.get(role) ?? 0)+1);orgs.set(mo,org);
    roles.set(role,(roles.get(role) ?? 0)+1);
    const key=[mo,role,sp].join(':');const g=groups.get(key) ?? [mo,role,sp,0,0];g[stage+3]++;groups.set(key,g);
  }
  const names = counts => [...counts].map(([i,n])=>[source.departments.roles[i],n]).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'ru'));
  return { ...source,
    summary: { ...source.summary,
      rows: source.summary.rows.map(row=>{const org=orgs.get(source.departments.mos.indexOf(row[0]));const n=org?.count ?? 0;return [...row.slice(0,4),n,stage===0?n:0,stage===1?n:0,row[7],org?names(org.roles):[]];}),
      topSpecialties:names(roles),trend:[[source.summary.sourceCut,records.length]],
    },
    departments:{...source.departments,rows:[...groups.values()]}, records:{...source.records,rows:records},
  };
}

/** Aggregate only common OIDs; unknown prior organizations never become a zero baseline. */
export function compareFrmrControl(previous, current, level = 'mo', type = '') {
  const known = new Set(previous.organizations);
  const before = new Map(previous.organizations.map(id => [id, 0]));
  const stage = level === 'mo' ? 0 : 1;
  for (const [id,,spType,issue,n] of previous.rows) if (issue === stage && (!type || spType === type)) before.set(id, (before.get(id) ?? 0)+n);
  const byMo = Object.fromEntries(current.summary.rows.map(row => [row[0], known.has(row[0]) ? before.get(row[0]) : null]));
  const common = current.summary.rows.filter(row => known.has(row[0]));
  return { cut: previous.cut, byMo, comparableOrganizations: common.length, missingBaseline: current.summary.rows.length-common.length,
    previousTotal: common.reduce((n,r)=>n+before.get(r[0]),0), currentTotal: common.reduce((n,r)=>n+r[4],0),
  };
}
