/**
 * Диагностика И‑38 по ВЫГРУЗКЕ РАСХОЖДЕНИЙ ФРМР, а не по полному реестру врачей.
 * Наличие записи не подтверждает причинную связь с отсутствием слотов.
 * Отсутствие записи НЕ означает отсутствия врача или отсутствия ошибок.
 */
export const FRMR_MO_OID_PREFIX = "1.2.643.5.1.13.13.12.2.16.";

export const I38_SPECIALTY_ROLES = Object.freeze({
  "11": ["Врач-терапевт", "Врач-терапевт участковый", "Врач-терапевт участковый цехового врачебного участка"],
  "13": ["Врач-акушер-гинеколог"],
  "25": ["Врач общей практики (семейный врач)"],
  "14": ["Врач-оториноларинголог"],
  "15": ["Врач-офтальмолог"],
  "16": ["Врач-педиатр", "Врач-педиатр участковый"],
  "17": ["Врач-психиатр детский", "Врач-психиатр детский участковый"],
  "18": ["Врач-психиатр-нарколог"],
  "19": ["Врач-стоматолог"],
  "20": ["Врач-стоматолог детский"],
  "21": ["Врач-стоматолог-терапевт"],
  "22": ["Врач-фтизиатр", "Врач-фтизиатр участковый"],
  "23": ["Врач-хирург"],
  "26": ["Врач - детский хирург"],
});

/**
 * @param {string} organizationOid Полный OID МО из И‑38
 * @param {string} specialtyCode Код специальности И‑38
 * @param {Array<Array<any>>} summaryRows summary.rows из frmr-all-specialties.json
 */
export function getFrmrSpecialtyIssues(organizationOid, specialtyCode, summaryRows) {
  const suffix = organizationOid.startsWith(FRMR_MO_OID_PREFIX)
    ? organizationOid.slice(FRMR_MO_OID_PREFIX.length) : null;
  const matches = suffix ? summaryRows.filter(row => row[0] === suffix) : [];
  const names = I38_SPECIALTY_ROLES[specialtyCode];
  if (matches.length !== 1 || !names) return { matched: false, count: null, roles: [] };
  const roles = (matches[0][8] ?? [])
    .filter(([role, count]) => names.includes(role) && Number.isFinite(count) && count > 0)
    .map(([role, count]) => ({ name: role, count }));
  return { matched: true, count: roles.reduce((sum, role) => sum + role.count, 0), roles };
}

/**
 * Данные ФРМО доступны только на уровне МО, не на уровне специальности.
 * @param {string} organizationOid
 * @param {Array<{parentOids?:string[], issues?:number, rows?:number}>} organizations
 */
export function getFrmoOrganizationFindings(organizationOid, organizations) {
  const matched = organizations.filter(org => (org.parentOids ?? []).includes(organizationOid));
  if (matched.length !== 1) return { matched: false, ambiguous: matched.length > 1, issues: null, rows: null };
  const org = matched[0];
  return { matched: true, ambiguous: false, issues: Number.isFinite(org.issues) ? org.issues : null, rows: Number.isFinite(org.rows) ? org.rows : null };
}
