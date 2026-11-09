/**
 * Display scope of the monthly ranking. Source datasets and archived scores remain untouched.
 * A branch is not an independent rated medical organization.
 */
export function isMonthlyBranchName(name) {
  return /^\s*филиал(?:\s|$|[«"])/iu.test(String(name ?? ""));
}

export function monthlyRatingBranchKeys(registry, spasskIdentity) {
  const keys = new Set(
    (registry?.organizations ?? [])
      .filter(org => isMonthlyBranchName(org.name) || isMonthlyBranchName(org.shortName))
      .map(org => org.oid)
      .filter(Boolean),
  );
  // The frozen rating uses a contextual key for Spassk, not its current FRMO OID.
  // Do not suppress the RKB parent (OID 1094) or infer branch identity from OID prefixes.
  if (spasskIdentity?.branch?.identityStatus === "confirmed_by_source" &&
      /Спасск/iu.test(spasskIdentity.branch.name ?? "")) {
    keys.add("context:spassk-crb");
  }
  return keys;
}

export function excludeMonthlyRatingBranches(rows, branchKeys) {
  return rows.filter(row =>
    !branchKeys.has(row.key ?? row.oid) && !isMonthlyBranchName(row.name),
  );
}
