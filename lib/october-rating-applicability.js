/**
 * Explicitly confirmed October 2026 applicability decisions for the monthly rating.
 * These are scoring-policy exceptions, NOT replacements of source/FRMR or staffing rows.
 * Only apply when the October export has no source row for the given indicator.
 */
const OctoberStaffAbsences = Object.freeze({
  "1.2.643.5.1.13.13.12.2.16.1182": Object.freeze({
    doctor500_dentist: Object.freeze({
      period: "2026-10",
      status: "not_applicable",
      reason: "По подтверждению ДГП № 2 г. Казани в октябре 2026 года трудоустроенных стоматологов не было. Показатель неприменим; в отчёте СЭМД строка отсутствует.",
      confirmation: "Уточнение от медицинской организации через Минздрав РТ, 09.11.2026",
    }),
  }),
});

export function octoberStaffAbsenceException(oid, metricId, sourceRow) {
  const rule = OctoberStaffAbsences[oid]?.[metricId];
  if (!rule || rule.period !== "2026-10") return null;
  // An actual source ratio must always supersede the manual applicability decision.
  if (sourceRow && sourceRow.sourceStatus !== "no_source_row") return null;
  return rule;
}
