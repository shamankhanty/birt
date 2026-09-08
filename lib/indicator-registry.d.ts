export type IndicatorDirection = "higher" | "lower";
export type IndicatorPeriodKind = "monthly" | "cumulative" | "operational" | "snapshot";
export type RatingPolicy = "include" | "exclude" | "conditional" | "not_applicable";
export type RatingBlock = "care" | "services" | "readiness";

export type IndicatorRegistryItem = {
  name: string;
  group?: string | null;
  plan: { value: number | null; period?: string | null };
  direction: IndicatorDirection;
  unit?: string | null;
  period: { kind: IndicatorPeriodKind; current?: string | null; date?: string | null };
  rating: { policy: RatingPolicy; baselineActive: boolean; block: RatingBlock; reason?: string | null };
  exclusions?: string[];
  management?: { hearingPriority?: boolean; reason?: string | null };
  rowExclusionRules?: string[];
};

export type IndicatorRegistryDocument = {
  schemaVersion: number;
  status: string;
  runtimeIntegration: boolean;
  rating: { blocks: Record<RatingBlock, number> };
  indicators: Record<string, IndicatorRegistryItem>;
};

export function createIndicatorRegistryRuntime(registry: IndicatorRegistryDocument): {
  registry: IndicatorRegistryDocument;
  indicators: Record<string, IndicatorRegistryItem>;
  get(id: string): IndicatorRegistryItem | null;
  requireIndicator(id: string): IndicatorRegistryItem;
  plan(id: string, fallback?: number | null): number | null;
  planPeriod(id: string, fallback?: string | null): string | null;
  direction(id: string, fallback?: IndicatorDirection): IndicatorDirection;
  periodKind(id: string, fallback?: IndicatorPeriodKind): IndicatorPeriodKind;
  ratingPolicy(id: string): RatingPolicy;
  ratingBlock(id: string): RatingBlock;
  ratingWeight(block: RatingBlock): number;
  canEnterRating(id: string): boolean;
  baselineRatingActive(id: string): boolean;
  exclusions(id: string): string[];
  affectsHearingPriority(id: string): boolean;
  rowExclusionRules(id: string): string[];
  hasRowExclusion(id: string, rule: string): boolean;
  metadata(id: string): {
    id: string;
    plan: number | null;
    planPeriod: string | null;
    direction: IndicatorDirection;
    periodKind: IndicatorPeriodKind;
    unit: string | null;
    ratingPolicy: RatingPolicy;
    ratingActive: boolean;
    ratingBlock: RatingBlock;
    exclusions: string[];
    hearingPriority: boolean;
    rowExclusionRules: string[];
  };
  applyToDataset<T extends object>(id: string, dataset: T): T & { plan: number | null; direction?: "lower"; periodKind: IndicatorPeriodKind };
  applyToDatasetMap<T extends Record<string, object>>(datasetMap: T): T;
  applyToStaticIndicator<T extends { id: string }>(indicator: T): T;
  applyToStaticIndicators<T extends { id: string }>(items: T[]): T[];
  validate(): { ok: boolean; issues: string[] };
};
