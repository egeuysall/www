export type ContentKind = "blog" | "diary" | "photo";
export const REPORT_REASONS = ["Spam", "Harassment", "Hate or abuse", "Other"] as const;

export function isContentKind(value: unknown): value is ContentKind {
  return value === "blog" || value === "diary" || value === "photo";
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function isReportReason(value: unknown): value is (typeof REPORT_REASONS)[number] {
  return typeof value === "string" && REPORT_REASONS.some((reason) => reason === value);
}
