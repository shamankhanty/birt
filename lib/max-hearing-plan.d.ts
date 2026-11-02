export function maxHearingPlan(targets: {organizationPlans:Record<string,{tmk:Record<string,number>;eln:Record<string,number>}>}, id:string, oid:string, date:string, period:string): {assigned:boolean;plan:number|null;label:string} | null;
export function maxHearingDeficit(id:string, fact:number|null, plan:number|null, applicable?:boolean): {targetCount:number;deficitCount:number} | null;
