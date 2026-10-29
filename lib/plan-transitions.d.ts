export type PlanTransition = 'reached' | 'lost';
export function planTransition(row: { fact?: number | null; previous?: number | null; sourceStatus?: string }, plan: number | null, options?: {lowerIsBetter?: boolean; disabled?: boolean}): PlanTransition | null;
