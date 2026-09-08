export type CalculationRecord = {
  method: string;
  source: string;
  numerator?: number;
  denominator?: number;
};

export type CalculatedIndicator = Record<string, unknown> & {
  id: string;
  fact: number;
  plan: number | null;
  calculation?: CalculationRecord;
};

export function ratioPercent(numerator: number, denominator: number): number;
export function aggregateComponents(details?: unknown[] | Record<string, unknown>): {
  numerator: number;
  denominator: number;
  fact: number;
};
export function aggregateCountRows(rows?: unknown[], includeRow?: (row: unknown) => boolean): number;
export function parseQuantityPair(value: unknown): { numerator: number; denominator: number } | null;
export function aggregateQuantityPairs(rows: unknown[], field: string): {
  numerator: number;
  denominator: number;
  fact: number;
  parsed: number;
};
export function scoreAgainstPlan(input: {
  fact: number | null;
  plan: number | null;
  direction?: string;
  reverse?: boolean;
}): number | null;
export function passedPlan(input: {
  fact: number | null;
  plan: number | null;
  direction?: string;
  reverse?: boolean;
}): boolean | null;
export function targetLag(input: {
  numerator: number | null;
  denominator: number | null;
  plan: number | null;
  direction?: string;
}): number | null;
export function createIndicatorCalculationRuntime(input: Record<string, unknown>): {
  indicators: CalculatedIndicator[];
  byId: Record<string, CalculatedIndicator>;
  datasetById: Record<string, CalculatedIndicator>;
  allById: Record<string, CalculatedIndicator>;
  get(id: string): CalculatedIndicator | null;
};
