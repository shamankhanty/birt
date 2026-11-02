export function frmrExclusionReason(role: string, department: string): 'trainee' | 'laboratory' | 'ambulance' | null;
export function applyFrmrScope<T>(source: T, types?: Record<string,string>): { data: T; excluded: { ambulance: number; trainee: number; laboratory: number; total: number } };
