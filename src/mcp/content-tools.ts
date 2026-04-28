import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { FastMCPSessionAuth, Tool } from "fastmcp";
import { z } from "zod";

export const jsonFeeds = ["diary", "blog", "agents", "photo"] as const;

export type JsonFeed = (typeof jsonFeeds)[number];
export type JsonFeedReader = (feed: JsonFeed) => Promise<string>;

const feedSet = new Set<string>(jsonFeeds);

const feedDescriptions: Record<JsonFeed, string> = {
  diary: "Return the raw contents of /diary.json from the site.",
  blog: "Return the raw contents of /blog.json from the site.",
  agents: "Return the raw contents of /agents.json from the site.",
  photo: "Return the raw contents of /photo.json from the site.",
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

export function assertJsonFeed(feed: JsonFeed): void {
  if (!feedSet.has(feed)) {
    throw new Error(`Unsupported JSON feed: ${String(feed)}`);
  }
}

export async function readBuiltJsonFeed(
  repoRoot: string,
  feed: JsonFeed,
): Promise<string> {
  assertJsonFeed(feed);

  const filePath = join(repoRoot, "dist", `${feed}.json`);

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Missing ${filePath}. Run the site build before using this MCP tool.`,
      );
    }

    throw error;
  }
}

export async function readJsonFeed(
  feed: JsonFeed,
  reader: JsonFeedReader,
): Promise<string> {
  assertJsonFeed(feed);

  return reader(feed);
}

export function createJsonFeedTools(
  reader: JsonFeedReader,
): Tool<FastMCPSessionAuth>[] {
  return jsonFeeds.map((feed) => ({
    name: `get_${feed}_json`,
    description: feedDescriptions[feed],
    parameters: z.object({}),
    annotations: {
      ...readOnlyAnnotations,
      title: `Get ${feed}.json`,
    },
    execute: async () => readJsonFeed(feed, reader),
  }));
}
