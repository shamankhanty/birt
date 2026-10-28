export type FederalSource = 'agreement' | 'collegium';
export function buildFederalDetailCatalog<T extends { id: string; type: string; regionalId?: string }>(control: Record<FederalSource, T[]>, metricIds: string[]): Array<{ key: string; source: FederalSource; row: T }>;
export function federalMetricTarget(row: { id: string; regionalId?: string }, source: FederalSource, metricIds: string[]): string;
