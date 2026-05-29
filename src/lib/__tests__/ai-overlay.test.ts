import { describe, expect, test } from "bun:test";

import {
  AI_PAGE_MAX_QUESTION_LENGTH,
  checkAiOverlayRateLimit,
  parseAiPageRequest,
} from "@/lib/ai-overlay";

describe("AI page request parsing", () => {
  test("accepts a normalized page question", () => {
    expect(
      parseAiPageRequest({
        question: " What is this page about? ",
        page: {
          path: "/blog/example/",
          title: "Example",
          description: "A page",
          content: "  visible content  ",
        },
      }),
    ).toEqual({
      question: "What is this page about?",
      page: {
        path: "/blog/example/",
        title: "Example",
        description: "A page",
        content: "visible content",
      },
    });
  });

  test("rejects unsafe paths and oversized questions", () => {
    expect(
      parseAiPageRequest({
        question: "ok",
        page: { path: "https://evil.test", title: "Bad", content: "content" },
      }),
    ).toBeNull();

    expect(
      parseAiPageRequest({
        question: "x".repeat(AI_PAGE_MAX_QUESTION_LENGTH + 1),
        page: { path: "/", title: "Home", content: "content" },
      }),
    ).toBeNull();
  });
});

describe("AI overlay rate limit", () => {
  test("allows requests up to the window limit then reports retry time", () => {
    const key = "127.0.0.1:/";

    for (let index = 0; index < 8; index += 1) {
      expect(checkAiOverlayRateLimit(key, 1_000)).toEqual({ allowed: true });
    }

    const limited = checkAiOverlayRateLimit(key, 1_001);
    expect(limited).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  test("resets the bucket after the window expires", () => {
    const key = "127.0.0.1:/blog/post/";

    for (let index = 0; index < 8; index += 1) {
      checkAiOverlayRateLimit(key, 10_000);
    }

    expect(checkAiOverlayRateLimit(key, 70_001)).toEqual({ allowed: true });
  });
});
