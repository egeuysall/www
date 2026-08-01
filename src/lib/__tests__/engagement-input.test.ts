import { describe, expect, test } from "bun:test";

import { isContentKind, isSlug } from "@/lib/engagement-input";

describe("engagement input", () => {
  test("allows scoped content keys and rejects path-shaped input", () => {
    expect(isContentKind("photo")).toBe(true);
    expect(isContentKind("admin")).toBe(false);
    expect(isSlug("my-post-2")).toBe(true);
    expect(isSlug("../my-post")).toBe(false);
    expect(isSlug("My Post")).toBe(false);
  });
});
