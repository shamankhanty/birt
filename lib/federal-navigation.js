/** Each source has its own numbering; never match unrelated indicators by name. */
export function buildFederalDetailCatalog(control, metricIds) {
  const regionalIds = new Set(metricIds);
  return ['agreement', 'collegium'].flatMap(source => (control[source] ?? [])
    .filter(row => row.type !== 'Компонент' && !regionalIds.has(row.regionalId))
    .map(row => ({ key: `federal:${source}:${row.id}`, source, row })));
}

export function federalMetricTarget(row, source, metricIds) {
  return row.regionalId && metricIds.includes(row.regionalId)
    ? row.regionalId : `federal:${source}:${row.id}`;
}
