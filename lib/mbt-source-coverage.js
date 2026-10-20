/**
 * Independent audit of REGULAR regional source coverage for MBT rows.
 * This is not a performance status. A manually entered fact can be
 * "Достигнут" or "Отклонение" while lacking a regular primary export.
 *
 * Classification lives in config/mbt-source-coverage.json and must be
 * explicitly reviewed when adding/changing MBT sources.
 */
export function mbtSourceKind(id, sources) {
  return sources[id] ?? "unknown";
}

export function mbtSourceLabel(kind) {
  switch (kind) {
    case "none":
      return "Нет регионального расчёта из регулярной выгрузки";
    case "manual":
      return "Ручные/внешние сведения · нет регулярной выгрузки";
    case "oneOff":
      return "Разовая сверка · нет регулярной выгрузки";
    case "partial":
      return "РЭМД: объём есть, автоматизация не подтверждена";
    case "regular":
      return "Есть данные регулярной выгрузки";
    default:
      return "Источник не классифицирован";
  }
}

/**
 * "missing" intentionally excludes only raw "В контракте", NOT the
 * distinct "Нет расчёта" status. Other filters stay source-only.
 */
export function matchesMbtSourceFilter(row, filter, sources) {
  if (filter === "all") return true;
  if (row.status === "В контракте") return false;
  const kind = mbtSourceKind(row.id, sources);
  if (filter === "missing")
    return kind === "none" || kind === "manual" || kind === "oneOff";
  return kind === filter;
}
