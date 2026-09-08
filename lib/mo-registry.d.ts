export type RegistryOrganization = {
  name: string;
  shortName: string;
  oid: string;
  type: string;
  district?: string;
  level?: string;
  kind?: string;
  stationary?: string;
  applicable: string[];
  aliases: string[];
};

export type MoRegistry = {
  source: string;
  normalizationRule?: string;
  organizations: RegistryOrganization[];
  unresolved: { sheet: string; name: string; reason?: string }[];
  matchStats?: Record<string, number>;
  diagnosticDenominatorDecision: {
    status: "pending" | "resolved";
    federalSource: number;
    registryUniqueTvsp: number;
    message: string;
  };
};

export type RegistryRow = { name: string; oid?: string };

export const SPASSK_CRB_REPORT_METRICS: Set<string>;
export const SPASSK_CRB_ORGANIZATION: Readonly<RegistryOrganization>;
export function cleanMoName(name: string): string;
export function moKey(name: string): string;
export function ratingMatchKey(name: string): string;
export function ratingCoreKey(name: string): string;
export function isContextualSpassk(metric: string, name: string): boolean;
export function reportMoName(metric: string, name: string): string;
export function createMoRegistryRuntime(registry: MoRegistry): Readonly<{
  byOid: Map<string, RegistryOrganization>;
  aliasCandidates: Map<string, RegistryOrganization[]>;
  looseCandidates: Map<string, RegistryOrganization[]>;
  coreCandidates: Map<string, RegistryOrganization[]>;
  organization(row: RegistryRow): RegistryOrganization | null | undefined;
  organizationByName(name: string): RegistryOrganization | null;
  organizationForMetric(metric: string, row: RegistryRow): RegistryOrganization | null | undefined;
  organizationByMetricAndName(metric: string, name: string): RegistryOrganization | null;
}>;
export function resolvedOrganizationOids(
  runtime: ReturnType<typeof createMoRegistryRuntime>,
  metric: string,
  rows: RegistryRow[],
): Set<string>;
export function findDroppedOrganizations(
  runtime: ReturnType<typeof createMoRegistryRuntime>,
  metric: string,
  previousRows: RegistryRow[],
  currentRows: RegistryRow[],
): Array<RegistryOrganization | { oid: string }>;
