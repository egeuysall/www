import { EdgeFastMCP } from "fastmcp/edge";
import { z } from "zod";

import { createJsonFeedTools, jsonFeeds, type JsonFeedReader } from "./content-tools";
import {
  brainFetchSchema,
  brainSearchSchema,
  briNotesSchema,
  fetchBrainResource,
  fetchBriNotes,
  fetchIbxTodos,
  ibxTodosSchema,
  searchBrainResources,
} from "./external-tools";

export function createMcpServer(reader: JsonFeedReader): EdgeFastMCP {
  const server = new EdgeFastMCP({
    mcpPath: "/mcp",
    name: "egeuysal-www",
    version: "0.1.0",
  });

  const tools = createJsonFeedTools(reader);

  for (const [index, tool] of tools.entries()) {
    const feed = jsonFeeds[index];

    server.addTool({
      name: tool.name,
      description: tool.description ?? `Read ${tool.name}`,
      parameters: z.object({}),
      execute: async () => reader(feed),
    });
  }

  server.addTool({
    name: "fetch_brain_resource",
    description:
      "Fetch a brain.egeuysal.com resource markdown file. Accepts a .md URL, page URL, routePath, or /resources path.",
    parameters: brainFetchSchema,
    execute: fetchBrainResource,
  });

  server.addTool({
    name: "search_brain_resources",
    description:
      "Search brain.egeuysal.com/api/routes.json across paginated route pages and return matching docs with markdownUrl.",
    parameters: brainSearchSchema,
    execute: searchBrainResources,
  });

  server.addTool({
    name: "get_bri_notes",
    description: "Fetch Bri notes from bri.fyi/api/notes with the configured bearer token.",
    parameters: briNotesSchema,
    execute: fetchBriNotes,
  });

  server.addTool({
    name: "get_ibx_todos",
    description:
      "Fetch IBX todos from ibx.egeuysal.com/api/todos with the configured bearer token.",
    parameters: ibxTodosSchema,
    execute: fetchIbxTodos,
  });

  return server;
}
