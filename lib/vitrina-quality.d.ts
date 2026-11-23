export type VitrinaQualityIssue = {
  id: string;
  orgId: string;
  orgName: string;
  unitName: string;
  category: string;
  level: "confirmed" | "review";
  field: string;
  original: string;
  instruction: string;
  reason: string;
  source: string;
};
export type VitrinaQualityOrganization = {
  id: string;
  name: string;
  before?: number;
  now: number;
  rows: Array<{parent?: string; name: string; address: string}>;
};
export declare const VITRINA_QUALITY_CATEGORIES: string[];
export declare const VITRINA_SOURCE_COVERAGE: Record<string, string>;
export declare function findVitrinaQualityIssues(org: VitrinaQualityOrganization): VitrinaQualityIssue[];
export declare function buildVitrinaQuality(organizations: VitrinaQualityOrganization[]): {
  rows: Array<VitrinaQualityOrganization & {issues: VitrinaQualityIssue[]}>;
  issues: VitrinaQualityIssue[];
  confirmed: VitrinaQualityIssue[];
  review: VitrinaQualityIssue[];
  organizations: number;
  organizationsWithIssues: number;
};
export declare function sortVitrinaQualityRows<T extends {name: string; issues: VitrinaQualityIssue[]}>(rows:T[], sortBy?:string):T[];
