/**
 * Quality signals for appointment-slot exports (Vitrina 2.0).
 * An alert is a request for verification, not proof of a federal violation.
 * Keep the export date and the date of the appointment as independent axes.
 *
 * Expected input is a normalized row supplied by a checked source importer:
 * { organizationId?, organizationName, subdivisionName?, specialty?,
 *   exportDate, appointmentDate, startTime?, endTime?, durationMinutes?, slotId? }
 */
const isTechnical = (name) => /ТЕСТОВОЕ ЛПУ|НЕИЗВЕСТНАЯ МО/iu.test(String(name || ""));
const dateKey = (value) => {
  const s = String(value ?? "").trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [day, month, year] = s.split(".");
    return year + "-" + month + "-" + day;
  }
  return s;
};
const minuteOfDay = (value) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim())) return null;
  const [hh, mm] = value.trim().split(":").map(Number);
  return hh * 60 + mm;
};
function durationOf(row) {
  if (row.durationMinutes !== null && row.durationMinutes !== undefined && String(row.durationMinutes).trim() !== "") {
    const n = typeof row.durationMinutes === "number" ? row.durationMinutes : Number(String(row.durationMinutes).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  const start = minuteOfDay(row.startTime);
  const end = minuteOfDay(row.endTime);
  // Do not guess that an end time before start time means the next day.
  return start !== null && end !== null && end >= start ? end - start : null;
}

/**
 * @param {Array<object>} rows
 * @param {{exportDate?:string, appointmentDate?:string, durationLimitMinutes?:number}} options
 */
export function analyzeVitrinaSlotSignals(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError("Slot source must be an array");
  const { exportDate, appointmentDate, durationLimitMinutes = 20 } = options;
  if (!Number.isFinite(durationLimitMinutes) || durationLimitMinutes <= 0) {
    throw new RangeError("Invalid duration threshold");
  }
  const scope = rows.map((row, sourceRowIndex) => ({ row, sourceRowIndex })).filter(({row}) => {
    if (!row || isTechnical(row.organizationName)) return false;
    if (exportDate !== undefined && dateKey(row.exportDate) !== dateKey(exportDate)) return false;
    if (appointmentDate !== undefined && dateKey(row.appointmentDate) !== dateKey(appointmentDate)) return false;
    return true;
  });
  const alerts = [];
  let durationChecked = 0;
  let durationUnavailable = 0;
  const seenIds = new Map();
  for (const {row, sourceRowIndex} of scope) {
    const orgName = String(row.organizationName ?? "").trim();
    const orgKey = String(row.organizationId ?? orgName).trim();
    const common = {
      orgKey, orgName,
      subdivisionName: String(row.subdivisionName ?? "").trim(),
      specialty: String(row.specialty ?? "").trim(),
      exportDate: dateKey(row.exportDate), appointmentDate: dateKey(row.appointmentDate),
      sourceRowIndex
    };
    const duration = durationOf(row);
    if (duration === null) {
      durationUnavailable++;
    } else {
      durationChecked++;
      if (duration > durationLimitMinutes) {
        alerts.push({
          ...common, code: "duration-over-limit", level: "review", durationMinutes: duration,
          message: "Время приёма " + duration + " мин превышает контрольный порог " + durationLimitMinutes + " мин",
          action: "Сверить длительность с расписанием врача в МИС и правилами профильного приёма"
        });
      } else if (duration <= 0) {
        alerts.push({
          ...common, code: "duration-invalid", level: "review", durationMinutes: duration,
          message: "Нулевая или отрицательная длительность приёма",
          action: "Проверить начало и окончание интервала в первичной МИС"
        });
      }
    }
    // Do not infer duplicate appointments from coinciding times: doctors,
    // rooms and slot identifiers may differ. Only repeated source slotIds qualify.
    const slotId = String(row.slotId ?? "").trim();
    if (slotId) {
      const identity = [orgKey, dateKey(row.exportDate), dateKey(row.appointmentDate), slotId].join("|");
      if (seenIds.has(identity)) {
        alerts.push({
          ...common, code: "duplicate-slot-id", level: "review", slotId,
          message: "Повтор идентификатора слота в одном срезе",
          action: "Проверить первичные строки выгрузки; не удалять автоматически"
        });
      } else seenIds.set(identity, sourceRowIndex);
    }
  }
  const affectedOrganizations = [...new Set(alerts.map((alert) => alert.orgKey).filter(Boolean))];
  return {
    sourceStatus: scope.length ? "available" : "no-data",
    exportDate: exportDate === undefined ? null : dateKey(exportDate),
    appointmentDate: appointmentDate === undefined ? null : dateKey(appointmentDate),
    checkedRows: scope.length ? scope.length : null,
    durationChecked: scope.length ? durationChecked : null,
    durationUnavailable: scope.length ? durationUnavailable : null,
    affectedOrganizationCount: scope.length ? affectedOrganizations.length : null,
    alerts,
  };
}
