export type VitrinaSortColumn = "name" | "before" | "now" | "delta";
export type VitrinaSortDirection = "asc" | "desc";
export type VitrinaSortRow = {
  id: string;
  name: string;
  before: number;
  now: number;
  delta: number;
};
export declare function sortVitrinaRows<T extends VitrinaSortRow>(
  rows: readonly T[],
  column?: VitrinaSortColumn,
  direction?: VitrinaSortDirection
): T[];
