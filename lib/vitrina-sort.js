/**
 * Stable, immutable table sorting for the Vitrina.
 * This is presentation-only; source names and counts are not changed.
 */
export function sortVitrinaRows(rows, column = "delta", direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const value = column === "name"
      ? a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
      : a[column] - b[column];
    return sign * value ||
      a.name.localeCompare(b.name, "ru", { sensitivity: "base" }) ||
      a.id.localeCompare(b.id);
  });
}
