import reorganizations from "../config/mo-reorganizations.json" with { type: "json" };

const groups = Array.isArray(reorganizations.groups) ? reorganizations.groups : [];

function periodEnd(dataset) {
  const text = String(dataset?.date ?? dataset?.period ?? "");
  const full = text.match(/(\d{2})\.(\d{2})\.(\d{4})/u);
  if (full) return `${full[3]}-${full[2]}-${full[1]}`;
  const year = text.match(/20\d{2}/u)?.[0];
  const monthNames = ["январ", "феврал", "март", "апрел", "май", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const month = monthNames.findIndex((name) => text.toLocaleLowerCase("ru").includes(name));
  return year && month >= 0 ? `${year}-${String(month + 1).padStart(2, "0")}-01` : null;
}

export function archivedOidsForDataset(dataset) {
  const end = periodEnd(dataset);
  if (!end) return new Set();
  return new Set(groups
    .filter((group) => end >= String(group.effectiveDate ?? "9999-12-31"))
    .flatMap((group) => (group.predecessors ?? []).map((item) => item.oldOid).filter(Boolean)));
}

export function filterActiveOrganizationRows(dataset) {
  if (!dataset || !Array.isArray(dataset.rows)) return dataset;
  const archived = archivedOidsForDataset(dataset);
  if (!archived.size) return dataset;
  return { ...dataset, rows: dataset.rows.filter((row) => !archived.has(row.oid)) };
}

export function filterActiveDatasetMap(datasetMap) {
  return Object.fromEntries(Object.entries(datasetMap ?? {}).map(([key, dataset]) => [key, filterActiveOrganizationRows(dataset)]));
}

export function isArchivedOrganizationOid(oid, dataset) {
  return Boolean(oid) && archivedOidsForDataset(dataset).has(oid);
}
