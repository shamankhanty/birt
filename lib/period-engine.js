const RU_MONTHS = [
  null,
  { nom: "январь", gen: "января", dat: "январю", ins: "январём", prep: "январе", adjective: "январские" },
  { nom: "февраль", gen: "февраля", dat: "февралю", ins: "февралём", prep: "феврале", adjective: "февральские" },
  { nom: "март", gen: "марта", dat: "марту", ins: "мартом", prep: "марте", adjective: "мартовские" },
  { nom: "апрель", gen: "апреля", dat: "апрелю", ins: "апрелем", prep: "апреле", adjective: "апрельские" },
  { nom: "май", gen: "мая", dat: "маю", ins: "маем", prep: "мае", adjective: "майские" },
  { nom: "июнь", gen: "июня", dat: "июню", ins: "июнем", prep: "июне", adjective: "июньские" },
  { nom: "июль", gen: "июля", dat: "июлю", ins: "июлем", prep: "июле", adjective: "июльские" },
  { nom: "август", gen: "августа", dat: "августу", ins: "августом", prep: "августе", adjective: "августовские" },
  { nom: "сентябрь", gen: "сентября", dat: "сентябрю", ins: "сентябрём", prep: "сентябре", adjective: "сентябрьские" },
  { nom: "октябрь", gen: "октября", dat: "октябрю", ins: "октябрём", prep: "октябре", adjective: "октябрьские" },
  { nom: "ноябрь", gen: "ноября", dat: "ноябрю", ins: "ноябрём", prep: "ноябре", adjective: "ноябрьские" },
  { nom: "декабрь", gen: "декабря", dat: "декабрю", ins: "декабрём", prep: "декабре", adjective: "декабрьские" },
];

const MONTH_STEMS = [
  [1, /январ/iu], [2, /феврал/iu], [3, /март/iu], [4, /апрел/iu],
  [5, /ма[йя]/iu], [6, /июн/iu], [7, /июл/iu], [8, /август/iu],
  [9, /сентябр/iu], [10, /октябр/iu], [11, /ноябр/iu], [12, /декабр/iu],
];

const pad = (n) => String(n).padStart(2, "0");

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseRussianDate(value) {
  if (!value) return null;
  const matches = [...String(value).matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/gu)];
  if (!matches.length) return null;
  const match = matches.at(-1);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { day, month, year };
}

export function parseMonthLabel(value, fallbackYear = null) {
  if (!value) return null;
  const text = String(value).toLowerCase();
  const yearMatch = text.match(/\b(20\d{2})\b/u);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;
  for (const [month, pattern] of MONTH_STEMS) {
    if (pattern.test(text) && year) return { month, year };
  }
  const shortDate = text.match(/(?:^|\D)(\d{1,2})\.(\d{1,2})(?:\D|$)/u);
  if (shortDate && year) {
    const month = Number(shortDate[2]);
    if (month >= 1 && month <= 12) return { month, year };
  }
  return null;
}

export function monthKey({ year, month }) {
  return year * 12 + month;
}

export function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function formatRussianDate({ year, month, day }) {
  return `${pad(day)}.${pad(month)}.${year}`;
}

export function formatMonthLabel({ year, month }, grammaticalCase = "nom", includeYear = true) {
  const value = RU_MONTHS[month]?.[grammaticalCase] ?? RU_MONTHS[month]?.nom;
  return includeYear ? `${value} ${year}` : value;
}

export function monthDescriptor(month) {
  const endDay = daysInMonth(month.year, month.month);
  return {
    ...month,
    startDate: `01.${pad(month.month)}.${month.year}`,
    endDate: `${pad(endDay)}.${pad(month.month)}.${month.year}`,
    label: formatMonthLabel(month),
    labelCapitalized: `${formatMonthLabel(month).charAt(0).toUpperCase()}${formatMonthLabel(month).slice(1)}`,
    genitive: formatMonthLabel(month, "gen"),
    dative: formatMonthLabel(month, "dat"),
    instrumental: formatMonthLabel(month, "ins"),
    adjective: RU_MONTHS[month.month]?.adjective ?? "",
    cumulativeLabel: `01.01–${pad(endDay)}.${pad(month.month)}.${month.year}`,
  };
}

export function inferPeriodKind({ period = null, periodType = null, periodKind = null, currentLabel = null, cadence = null } = {}) {
  const explicitKind = String(periodKind ?? "").toLowerCase();
  if (["monthly", "cumulative", "operational", "snapshot"].includes(explicitKind)) return explicitKind;
  const type = String(periodType ?? "").toLowerCase();
  const p = String(period ?? "").toLowerCase();
  const label = String(currentLabel ?? "").toLowerCase();
  const cadenceText = String(cadence ?? "").toLowerCase();
  if (type === "month" || type === "monthly") return "monthly";
  if (p.startsWith("01.01") || /январ[ья]\s*[–-]/u.test(p) || cadenceText.includes("накоп")) return "cumulative";
  if (/^на\s+\d{1,2}\.\d{1,2}/u.test(label) && p.startsWith("01.01")) return "cumulative";
  if (MONTH_STEMS.some(([, pattern]) => pattern.test(p)) && !/[–-]/u.test(p)) return "monthly";
  if (MONTH_STEMS.some(([, pattern]) => pattern.test(label)) && !/^на\s+/u.test(label)) return "monthly";
  if (/^на\s+\d{1,2}\.\d{1,2}/u.test(label)) return "snapshot";
  return "snapshot";
}

function candidateFromDataset(dataset) {
  const date = parseRussianDate(dataset?.date ?? dataset?.formed ?? dataset?.period);
  if (!date) return null;
  const isMonthEnd = date.day === daysInMonth(date.year, date.month);
  const explicitMonth = parseMonthLabel(dataset?.period, date.year);
  const periodKind = inferPeriodKind(dataset ?? {});
  if (isMonthEnd || (periodKind === "monthly" && explicitMonth)) return { year: date.year, month: date.month };
  return null;
}

function candidatesFromMonthlyDataset(dataset, fallbackYear) {
  const labels = [dataset?.currentLabel, dataset?.previousLabel].filter(Boolean);
  return labels.flatMap((label) => {
    const date = parseRussianDate(label);
    if (date && date.day === daysInMonth(date.year, date.month)) return [{ year: date.year, month: date.month }];
    const parsed = parseMonthLabel(label, fallbackYear);
    if (!parsed) return [];
    // A named calendar month (e.g. "Август 2026") is an explicit full-month marker.
    if (!/^на\s+/iu.test(String(label))) return [parsed];
    // "На 31.08" is full-month only if the day is the actual month end.
    const shortDate = String(label).match(/(\d{1,2})\.(\d{1,2})/u);
    if (shortDate && Number(shortDate[1]) === daysInMonth(parsed.year, parsed.month)) return [parsed];
    return [];
  });
}

export function resolveReportingPeriods({ monthlyDatasets = {}, datasets = [], physicianMetrics = null, fallbackYear = 2026 } = {}) {
  const candidates = [];
  const observedDates = [];
  for (const dataset of Object.values(monthlyDatasets ?? {})) {
    candidates.push(...candidatesFromMonthlyDataset(dataset, fallbackYear));
  }
  for (const dataset of datasets ?? []) {
    const observed = parseRussianDate(dataset?.date ?? dataset?.formed ?? dataset?.period);
    if (observed) observedDates.push(observed);
    const candidate = candidateFromDataset(dataset);
    if (candidate) candidates.push(candidate);
  }
  if (physicianMetrics) {
    const physicianObserved = parseRussianDate(physicianMetrics.formed ?? physicianMetrics.period);
    if (physicianObserved) observedDates.push(physicianObserved);
    const physicianCandidate = candidateFromDataset({
      date: physicianMetrics.formed,
      formed: physicianMetrics.formed,
      period: physicianMetrics.period,
      periodType: "month",
    });
    if (physicianCandidate) candidates.push(physicianCandidate);
  }
  if (!candidates.length) throw new Error("Cannot determine the latest full month from current datasets");
  candidates.sort((a, b) => monthKey(a) - monthKey(b));
  const latest = candidates.at(-1);
  const previous = previousMonth(latest);
  observedDates.sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month !== b.month ? a.month - b.month : a.day - b.day,
  );
  const latestObserved = observedDates.at(-1) ?? { ...latest, day: daysInMonth(latest.year, latest.month) };
  const observedMonth = { year: latestObserved.year, month: latestObserved.month };
  return {
    latestFullMonth: monthDescriptor(latest),
    previousFullMonth: monthDescriptor(previous),
    latestObservedDate: formatRussianDate(latestObserved),
    latestObservedMonth: monthDescriptor(observedMonth),
    hasPartialNewerMonth: monthKey(observedMonth) > monthKey(latest),
  };
}

function monthFromDatasetLabel(dataset, fallbackYear) {
  const label = dataset?.currentLabel ?? "";
  const explicitDate = parseRussianDate(label);
  if (explicitDate) return { year: explicitDate.year, month: explicitDate.month };
  const datasetDate = parseRussianDate(dataset?.date);
  const year = datasetDate?.year ?? fallbackYear;
  return parseMonthLabel(label, year) ?? (datasetDate ? { year: datasetDate.year, month: datasetDate.month } : null);
}

export function datasetBelongsToReportingMonth(dataset, reportingMonth, fallbackYear = reportingMonth.year) {
  const parsed = monthFromDatasetLabel(dataset, fallbackYear);
  return Boolean(parsed && parsed.year === reportingMonth.year && parsed.month === reportingMonth.month);
}

export function datasetHasExplicitFullMonth(dataset, reportingMonth, fallbackYear = reportingMonth.year) {
  if (!datasetBelongsToReportingMonth(dataset, reportingMonth, fallbackYear)) return false;
  const label = String(dataset?.currentLabel ?? "");
  if (parseMonthLabel(label, fallbackYear) && !/^на\s+/iu.test(label)) return true;
  const full = parseRussianDate(label) ?? parseRussianDate(dataset?.date);
  return Boolean(full && full.day === daysInMonth(full.year, full.month));
}

export function buildFullMonthComparison(reportingPeriods, kind = "cumulative") {
  const previous = reportingPeriods.previousFullMonth;
  const current = reportingPeriods.latestFullMonth;
  if (kind === "monthly") return { previous: previous.label, current: current.label };
  return { previous: previous.cumulativeLabel, current: current.cumulativeLabel };
}
