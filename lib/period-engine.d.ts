export type PeriodKind = "monthly" | "cumulative" | "operational" | "snapshot";
export type CalendarMonth = { year: number; month: number };
export type MonthDescriptor = CalendarMonth & {
  startDate: string;
  endDate: string;
  label: string;
  labelCapitalized: string;
  genitive: string;
  dative: string;
  instrumental: string;
  adjective: string;
  cumulativeLabel: string;
};
export type ReportingPeriods = {
  latestFullMonth: MonthDescriptor;
  previousFullMonth: MonthDescriptor;
  latestObservedDate: string;
  latestObservedMonth: MonthDescriptor;
  hasPartialNewerMonth: boolean;
};

export function daysInMonth(year: number, month: number): number;
export function parseRussianDate(value: unknown): { day: number; month: number; year: number } | null;
export function parseMonthLabel(value: unknown, fallbackYear?: number | null): CalendarMonth | null;
export function monthKey(month: CalendarMonth): number;
export function previousMonth(month: CalendarMonth): CalendarMonth;
export function formatRussianDate(date: { year: number; month: number; day: number }): string;
export function formatMonthLabel(month: CalendarMonth, grammaticalCase?: "nom" | "gen" | "dat" | "ins" | "prep", includeYear?: boolean): string;
export function monthDescriptor(month: CalendarMonth): MonthDescriptor;
export function inferPeriodKind(input?: { period?: string | null; periodType?: string | null; periodKind?: PeriodKind | null; currentLabel?: string | null; cadence?: string | null }): PeriodKind;
export function resolveReportingPeriods(input?: { monthlyDatasets?: Record<string, unknown>; datasets?: unknown[]; physicianMetrics?: unknown; fallbackYear?: number }): ReportingPeriods;
export function datasetBelongsToReportingMonth(dataset: unknown, reportingMonth: CalendarMonth, fallbackYear?: number): boolean;
export function datasetHasExplicitFullMonth(dataset: unknown, reportingMonth: CalendarMonth, fallbackYear?: number): boolean;
export function buildFullMonthComparison(reportingPeriods: ReportingPeriods, kind?: "monthly" | "cumulative"): { previous: string; current: string };
