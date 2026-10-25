import { describe, expect, test } from "bun:test";

import { resolveContentCdnShorthand } from "@/lib/content-cdn";

describe("content CDN URLs", () => {
  test("maps public IBX library links to the legacy CDN path", () => {
    expect(resolveContentCdnShorthand("https://ibx.egeuysal.com/egeuysall/content/2026/10/25/image.png"))
      .toBe("https://cdn.egeuysal.com/content/2026/10/25/image.png");
    expect(resolveContentCdnShorthand("https://ibx.egeuysal.com/egeuysall/photo-1080/img-41.jpg?x=1"))
      .toBe("https://cdn.egeuysal.com/photo-1080/img-41.jpg?x=1");
  });

  test("keeps unrelated URLs and shorthand behavior", () => {
    expect(resolveContentCdnShorthand("https://example.com/image.png")).toBe("https://example.com/image.png");
    expect(resolveContentCdnShorthand("2026/10/image.png")).toBe("https://cdn.egeuysal.com/content/2026/10/image.png");
  });
});
