/**
 * Management rating applicability for pediatric medical organizations.
 *
 * A therapist 500+ entry at a pediatric MO remains available for inspection,
 * but does not enter the scored set, denominator, leader status or place.
 * Do not modify the underlying monthly physician source or frozen snapshots.
 */
export const PEDIATRIC_THERAPIST_REFERENCE_REASON =
  "Справочно: терапевты 500+ в детской МО не влияют на балл, полноту обязательных показателей и место в рейтинге.";

export function isPediatricRatingOrganization(organization) {
  if (organization?.type === "Детские городские поликлиники") return true;
  const name = String(organization?.name ?? "").trim();
  // Pediatric hospitals/specialized organizations can belong to mixed registry groups.
  return /^(?:дгб|дгкб|дгп|дсп|дркб|кдмц)(?:\s|№|$)/iu.test(name);
}

export function applyPediatricTherapistReferencePolicy(organization) {
  if (!isPediatricRatingOrganization(organization) ||
      !organization.metrics.some(metric => metric.id === "doctor500_therapist")) {
    return organization;
  }
  return {
    ...organization,
    metrics: organization.metrics.map(metric => metric.id === "doctor500_therapist"
      ? { ...metric, status: "reference_only", reason: PEDIATRIC_THERAPIST_REFERENCE_REASON }
      : metric),
  };
}
