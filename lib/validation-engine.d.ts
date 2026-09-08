export type ValidationStatus = "PASS" | "WARNING" | "FAIL";
export const VALIDATION_STATUS: Readonly<{ PASS: "PASS"; WARNING: "WARNING"; FAIL: "FAIL" }>;
export function createValidationSnapshot(input: Record<string, unknown>): Record<string, unknown>;
export function validateDashboard(input: Record<string, unknown>): Record<string, unknown>;
export function createAiReviewQueue(report: Record<string, unknown>): Record<string, unknown>;
