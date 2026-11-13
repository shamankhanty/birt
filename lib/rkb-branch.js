/**
 * Source-scoped branch identity for RKB / Spassk. The registers support
 * subunit identification. Aggregation requires separate source reconciliation.
 * Never infer branch membership from parent MO OID 1094 or code 6601 alone.
 */
export function classifyRkbSourceRow(row, catalog, metric = null) {
  const parentOid = catalog.parent.oid;
  const moOid = String(row?.moOid ?? row?.organizationOid ?? row?.oid ?? "").trim();
  const spOid = String(row?.spOid ?? row?.subunitOid ?? row?.["OID СП МО"] ?? "").trim();
  const buildingId = String(row?.buildingId ?? row?.["ID здания"] ?? "").trim();
  const name = String(row?.name ?? row?.["Наименование медицинской организации"] ?? "").trim();
  const explicitBranch = /Спасская\s+ЦРБ/iu.test(name);
  const frmo = catalog.frmoSubdivisionRegister;
  const legacyBranchUnit = catalog.subunits.find((unit) => unit.spOid === spOid);
  const legacyParentUnit = catalog.parentSubunits?.find((unit) => unit.spOid === spOid);
  const known = frmo?.spassk.find((unit) => unit.spOid === spOid) ?? legacyBranchUnit;
  const parentUnit = frmo?.rkb.find((unit) => unit.spOid === spOid) ?? legacyParentUnit;
  const branchBuilding = catalog.subunits.some((unit) => unit.buildingId === buildingId);
  const parentBuilding = catalog.parentSubunits?.some((unit) => unit.buildingIds.includes(buildingId));
  const sourceReports = new Set([
    row?.sourceReport,
    ...(Array.isArray(row?.sourceReports) ? row.sourceReports : []),
  ].filter(Boolean));
  const allowedReport = catalog.reportAliases?.rules.some((rule) =>
    sourceReports.has(rule.sourceReport) && rule.metrics.includes(metric));
  const rkbName = /^(?:ГАУЗ\s*)?["«]?РКБ(?:\s+МЗ\s+РТ)?["»]?$/iu.test(name);
  const conflict = Boolean(
    frmo?.divisionConflicts.some((unit) => unit.spOid === spOid) ||
    (moOid && moOid !== parentOid && (known || parentUnit || explicitBranch || branchBuilding || parentBuilding)) ||
    (explicitBranch && parentBuilding) ||
    (known && parentBuilding) || (parentUnit && (branchBuilding || explicitBranch)) ||
    (legacyBranchUnit && buildingId && legacyBranchUnit.buildingId !== buildingId) ||
    (legacyParentUnit && buildingId && !legacyParentUnit.buildingIds.includes(buildingId)) ||
    (parentUnit && allowedReport)
  );
  if (conflict) {
    return { status: "conflict", ownerOid: null, branchCode: null, spOid: spOid || null, aggregationApproved: false };
  }
  if (known) {
    return {
      status: "spassk-subunit", ownerOid: parentOid, branchCode: catalog.branch.historicCode,
      spOid: known.spOid, buildingId: legacyBranchUnit?.buildingId ?? null, subunitName: known.name,
      identityConfirmed: true, aggregationApproved: false,
    };
  }
  if (parentUnit) {
    return { status: "rkb-subunit", ownerOid: parentOid, branchCode: null,
      spOid, subunitName: parentUnit.name, identityConfirmed: true, aggregationApproved: false };
  }
  if (spOid && spOid.startsWith(parentOid + ".0.")) {
    return { status: "unverified-rkb-subunit", ownerOid: parentOid, branchCode: null, spOid, aggregationApproved: false };
  }
  if (spOid) {
    return { status: "unverified-foreign-subunit", ownerOid: moOid || null, branchCode: null, spOid, aggregationApproved: false };
  }
  if (allowedReport && (rkbName || explicitBranch) && (!moOid || moOid === parentOid)) {
    if (parentBuilding) return { status: "conflict", ownerOid: null, branchCode: null, aggregationApproved: false };
    return { status: "spassk-approved-report", ownerOid: parentOid,
      branchCode: catalog.branch.historicCode, spOid: null,
      sourceReport: row.sourceReport, identityConfirmed: true, aggregationApproved: false };
  }
  if (explicitBranch) {
    return { status: "spassk-name-only", ownerOid: parentOid, branchCode: catalog.branch.historicCode, spOid: null, aggregationApproved: false };
  }
  if (branchBuilding && (!moOid || moOid === parentOid)) {
    return { status: "spassk-building-only", ownerOid: parentOid,
      branchCode: catalog.branch.historicCode, spOid: null, identityConfirmed: true, aggregationApproved: false };
  }
  if (parentBuilding && (!moOid || moOid === parentOid)) {
    return { status: "rkb-building-only", ownerOid: parentOid, branchCode: null,
      spOid: null, identityConfirmed: true, aggregationApproved: false };
  }
  if (moOid === parentOid || rkbName) {
    return { status: "rkb-parent-only", ownerOid: parentOid, branchCode: null, spOid: null, aggregationApproved: false };
  }
  return { status: "outside-or-unknown", ownerOid: moOid || null, branchCode: null, spOid: null, aggregationApproved: false };
}

export function validateRkbBranchCatalog(catalog) {
  const units = catalog.subunits;
  const uniqueOids = new Set(units.map((u) => u.spOid));
  const buildings = new Set(units.map((u) => u.buildingId));
  const parentUnits = catalog.parentSubunits ?? [];
  const parentOids = new Set(parentUnits.map((unit) => unit.spOid));
  const parentBuildings = new Set(parentUnits.flatMap((unit) => unit.buildingIds));
  return {
    valid: catalog.policy.scope === "source-identity" &&
      units.length === 39 && uniqueOids.size === 39 && buildings.size === 37 &&
      parentUnits.length === 98 && parentOids.size === 98 && parentBuildings.size === 11 &&
      [...parentOids].every((oid) => !uniqueOids.has(oid) && oid.startsWith(catalog.parent.oid + ".0.")) &&
      [...parentBuildings].every((id) => !buildings.has(id)) &&
      units.every((u) => u.spOid.startsWith(catalog.parent.oid + ".0.") && Boolean(u.name && u.buildingId)),
    subunitCount: uniqueOids.size,
    buildingCount: buildings.size,
    parentSubunitCount: parentOids.size,
    parentBuildingCount: parentBuildings.size,
  };
}
