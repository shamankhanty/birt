/**
 * Source-scoped branch identity for RKB / Spassk. The uploaded RKB workbook
 * supports subunit identification, NOT fact aggregation or period equivalence.
 * Never infer branch membership from parent MO OID 1094 or code 6601 alone.
 */
export function classifyRkbSourceRow(row, catalog) {
  const parentOid = catalog.parent.oid;
  const moOid = String(row?.moOid ?? row?.organizationOid ?? row?.oid ?? "").trim();
  const spOid = String(row?.spOid ?? row?.subunitOid ?? row?.["OID СП МО"] ?? "").trim();
  const buildingId = String(row?.buildingId ?? row?.["ID здания"] ?? "").trim();
  const name = String(row?.name ?? row?.["Наименование медицинской организации"] ?? "").trim();
  const explicitBranch = /Спасская\\s+ЦРБ/iu.test(name);
  const bySp = new Map(catalog.subunits.map((subunit) => [subunit.spOid, subunit]));
  const known = spOid ? bySp.get(spOid) : null;
  const conflict = Boolean(moOid && moOid !== parentOid && (known || explicitBranch));
  if (conflict) {
    return { status: "conflict", ownerOid: null, branchCode: null, spOid: spOid || null, aggregationApproved: false };
  }
  if (known) {
    return {
      status: "spassk-subunit", ownerOid: parentOid, branchCode: catalog.branch.historicCode,
      spOid: known.spOid, buildingId: known.buildingId, subunitName: known.name,
      aggregationApproved: false,
    };
  }
  if (spOid && spOid.startsWith(parentOid + ".0.")) {
    return { status: "unverified-rkb-subunit", ownerOid: parentOid, branchCode: null, spOid, aggregationApproved: false };
  }
  if (spOid) {
    return { status: "unverified-foreign-subunit", ownerOid: moOid || null, branchCode: null, spOid, aggregationApproved: false };
  }
  if (explicitBranch) {
    return { status: "spassk-name-only", ownerOid: parentOid, branchCode: catalog.branch.historicCode, spOid: null, aggregationApproved: false };
  }
  if (moOid === parentOid || /^(?:ГАУЗ\\s*)?["«]?РКБ(?:\\s+МЗ\\s+РТ)?["»]?$/iu.test(name)) {
    return { status: "rkb-parent-only", ownerOid: parentOid, branchCode: null, spOid: null, aggregationApproved: false };
  }
  if (buildingId && catalog.subunits.some((unit) => unit.buildingId === buildingId)) {
    return { status: "spassk-building-only", ownerOid: parentOid, branchCode: null, spOid: null, aggregationApproved: false };
  }
  return { status: "outside-or-unknown", ownerOid: moOid || null, branchCode: null, spOid: null, aggregationApproved: false };
}

export function validateRkbBranchCatalog(catalog) {
  const units = catalog.subunits;
  const uniqueOids = new Set(units.map((u) => u.spOid));
  const buildings = new Set(units.map((u) => u.buildingId));
  return {
    valid: catalog.policy.scope === "reference-only" &&
      units.length === 39 && uniqueOids.size === 39 && buildings.size === 37 &&
      units.every((u) => u.spOid.startsWith(catalog.parent.oid + ".0.") && Boolean(u.name && u.buildingId)),
    subunitCount: uniqueOids.size,
    buildingCount: buildings.size,
  };
}
