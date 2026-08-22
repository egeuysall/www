import { expect, test } from "bun:test";

import { slugFromPost, validFrontmatter } from "@/lib/blog-editor";

test("generates a safe slug from post title frontmatter", () => {
  expect(slugFromPost('---\ntitle: "Hello, İstanbul!"\ndescription: Test\n---\n')).toBe("hello-istanbul");
  expect(slugFromPost("---\ndescription: Missing title\n---\n")).toBe("");
});

test("accepts the frontmatter required for a published post", () => {
  expect(validFrontmatter('---\ntitle: "Hello"\ndescription: Test\npublishedAt: 2026-08-22\n---\n')).toBe(true);
  expect(validFrontmatter('---\ntitle: "Hello"\ndescription: Test\n---\n')).toBe(false);
});
