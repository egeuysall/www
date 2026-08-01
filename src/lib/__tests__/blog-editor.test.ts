import { expect, test } from "bun:test";

import { slugFromPost } from "@/lib/blog-editor";

test("generates a safe slug from post title frontmatter", () => {
  expect(slugFromPost('---\ntitle: "Hello, İstanbul!"\ndescription: Test\n---\n')).toBe("hello-istanbul");
  expect(slugFromPost("---\ndescription: Missing title\n---\n")).toBe("");
});
