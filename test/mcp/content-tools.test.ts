import { describe, expect, test } from "bun:test";

import { createJsonFeedTools, readJsonFeed } from "@/mcp/content-tools";
import { getMcpBrowserInfoResponse } from "@/mcp/dev-middleware";
import { toBrainMarkdownUrl } from "@/mcp/external-tools";
import { createMcpServer } from "@/mcp/server";

const testReader = async (feed: string) => JSON.stringify({ feed });

describe("MCP content tools", () => {
  test("readJsonFeed returns JSON from the configured feed reader", async () => {
    const diaryJson = await readJsonFeed("diary", testReader);
    const diary = JSON.parse(diaryJson);

    expect(diary).toEqual({ feed: "diary" });
  });

  test("readJsonFeed rejects unknown feed names", async () => {
    await expect(readJsonFeed("private" as never, testReader)).rejects.toThrow(
      /Unsupported JSON feed/,
    );
  });

  test("createJsonFeedTools exposes one read-only tool for each root JSON feed", () => {
    const tools = createJsonFeedTools(testReader);

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_diary_json",
      "get_blog_json",
      "get_agents_json",
      "get_photo_json",
    ]);
    expect(tools).toHaveLength(4);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);
  });

  test("createMcpServer serves tools over the /mcp HTTP endpoint", async () => {
    const server = createMcpServer(testReader);
    const response = await server.fetch(
      new Request("http://localhost:4321/mcp", {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_diary_json",
      "get_blog_json",
      "get_agents_json",
      "get_photo_json",
      "fetch_brain_resource",
      "search_brain_resources",
      "get_bri_notes",
      "get_ibx_todos",
    ]);
  });

  test("browser-friendly metadata documents the /mcp endpoint", async () => {
    const response = getMcpBrowserInfoResponse();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toMatchObject({
      endpoint: "/mcp",
      name: "egeuysal-www",
      protocol: {
        method: "POST",
      },
      tools: {
        fetch_brain_resource: expect.any(Object),
        get_bri_notes: expect.any(Object),
        get_ibx_todos: expect.any(Object),
        search_brain_resources: expect.any(Object),
      },
    });
  });

  test("toBrainMarkdownUrl resolves brain routes to direct markdown URLs", () => {
    expect(toBrainMarkdownUrl("/resources/articles/example")).toBe(
      "https://brain.egeuysal.com/resources/articles/example.md",
    );
    expect(toBrainMarkdownUrl("https://brain.egeuysal.com/resources/docs/plan")).toBe(
      "https://brain.egeuysal.com/resources/docs/plan.md",
    );
    expect(
      toBrainMarkdownUrl("resources/articles/2026-03-21-133927.mdx"),
    ).toBe("https://brain.egeuysal.com/resources/articles/2026-03-21-133927.md");
    expect(() => toBrainMarkdownUrl("https://example.com/")).toThrow(
      /Only brain\.egeuysal\.com/,
    );
  });
});
