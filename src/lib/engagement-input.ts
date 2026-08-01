export type ContentKind = "blog" | "diary" | "photo";

export function isContentKind(value: unknown): value is ContentKind {
  return value === "blog" || value === "diary" || value === "photo";
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
