import { snapshotDay } from "./operational-comparison.js";

/**
 * Оценка новых заявлений по приросту знаменателя двух сопоставимых
 * накопительных выгрузок ЕПГУ. Это НЕ число уникальных вновь
 * зарегистрированных обращений: возможны ретроспективные корректировки.
 * Один и тот же знаменатель используется в двух показателях прикрепления.
 */
export function estimateAttachmentInflow(dataset) {
  if (!dataset || !Number.isSafeInteger(dataset.denominator)
    || !Number.isSafeInteger(dataset.previousDenominator)
    || dataset.denominator < 0 || dataset.previousDenominator < 0) return null;

  const currentDay = snapshotDay(dataset.date);
  const previousDay = snapshotDay(dataset.previousDate);
  if (currentDay === null || previousDay === null || currentDay <= previousDay) return null;

  // Only compare cumulative periods with the same start date; never mix
  // monthly and cumulative cuts, or counts covering different perimeters.
  const start = (period) => {
    if (typeof period !== "string" || !period.includes("–")) return null;
    const [beginning, end] = period.split("–");
    return beginning?.trim() && end?.trim() ? beginning.trim() : null;
  };
  const currentStart = start(dataset.period);
  const previousStart = start(dataset.previousPeriod);
  if (!currentStart || currentStart !== previousStart) return null;
  if (!dataset.period.endsWith(dataset.date) || !dataset.previousPeriod.endsWith(dataset.previousDate)) return null;
  if (dataset.denominator < dataset.previousDenominator) return null;

  return {
    count: dataset.denominator - dataset.previousDenominator,
    currentTotal: dataset.denominator,
    previousTotal: dataset.previousDenominator,
    previousDate: dataset.previousDate,
    currentDate: dataset.date,
    source: "разность накопительных знаменателей",
  };
}
