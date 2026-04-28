import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";

import type { Connect } from "vite";

import { assertJsonFeed, type JsonFeed } from "./content-tools";
import { createMcpServer } from "./server";

function getHeaderEntries(headers: Connect.IncomingMessage["headers"]) {
  const entries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push([key, item]);
      }
    } else if (value !== undefined) {
      entries.push([key, value]);
    }
  }

  return entries;
}

function toWebRequest(request: Connect.IncomingMessage): Request {
  const host = request.headers.host ?? "localhost:4321";
  const url = new URL(request.url ?? "/mcp", `http://${host}`);
  if (url.pathname === "/") {
    url.pathname = "/mcp";
  }
  const method = request.method ?? "GET";
  const headers = new Headers(getHeaderEntries(request.headers));

  if (method === "GET" || method === "HEAD") {
    return new Request(url, { headers, method });
  }

  const init = {
    body: request,
    // Required by Node's fetch implementation for streaming request bodies.
    duplex: "half",
    headers,
    method,
  } as unknown as RequestInit & { duplex: "half" };

  return new Request(url, init);
}

async function writeWebResponse(
  serverResponse: ServerResponse,
  webResponse: Response,
) {
  serverResponse.statusCode = webResponse.status;
  serverResponse.statusMessage = webResponse.statusText;

  webResponse.headers.forEach((value, key) => {
    serverResponse.setHeader(key, value);
  });

  if (!webResponse.body) {
    serverResponse.end();
    return;
  }

  Readable.fromWeb(webResponse.body).pipe(serverResponse);
}

async function readSameOriginJsonFeed(origin: string, feed: JsonFeed) {
  assertJsonFeed(feed);

  const response = await fetch(new URL(`/${feed}.json`, origin));

  if (!response.ok) {
    throw new Error(`Failed to fetch /${feed}.json: HTTP ${response.status}`);
  }

  return response.text();
}

export function getMcpBrowserInfoResponse() {
  return new Response(
    JSON.stringify(
      {
        name: "egeuysal-www",
        transport: "MCP streamable HTTP",
        endpoint: "/mcp",
        protocol: {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          exampleBody: {
            id: 1,
            jsonrpc: "2.0",
            method: "tools/list",
          },
        },
        tools: {
          get_diary_json: {
            description: "Return this site's /diary.json feed.",
            arguments: {},
          },
          get_blog_json: {
            description: "Return this site's /blog.json feed.",
            arguments: {},
          },
          get_agents_json: {
            description: "Return this site's /agents.json feed.",
            arguments: {},
          },
          get_photo_json: {
            description: "Return this site's /photo.json feed.",
            arguments: {},
          },
          search_brain_resources: {
            description:
              "Search brain.egeuysal.com/api/routes.json across paginated route pages. Returns docs with markdownUrl.",
            arguments: {
              query: "optional text search over title/path/sourcePath",
              routePrefix: "optional prefix such as resources/articles or resources/posts",
              limit: "optional 1-200, default 50",
              maxPages: "optional 1-100, default 50",
            },
            example: {
              id: 2,
              jsonrpc: "2.0",
              method: "tools/call",
              params: {
                name: "search_brain_resources",
                arguments: {
                  query: "pitch deck",
                  routePrefix: "resources/articles",
                  limit: 5,
                },
              },
            },
          },
          fetch_brain_resource: {
            description:
              "Fetch markdown from brain.egeuysal.com. Accepts markdownUrl, page URL, routePath, or /resources path.",
            arguments: {
              urlOrPath:
                "for example https://brain.egeuysal.com/resources/articles/2026-03-21-133927.md",
            },
            example: {
              id: 3,
              jsonrpc: "2.0",
              method: "tools/call",
              params: {
                name: "fetch_brain_resource",
                arguments: {
                  urlOrPath:
                    "https://brain.egeuysal.com/resources/articles/2026-03-21-133927.md",
                },
              },
            },
          },
          get_bri_notes: {
            description: "Fetch Bri notes from bri.fyi/api/notes.",
            arguments: {
              query: "optional text search over title/slug/content",
              limit: "optional 1-200, default 50",
            },
          },
          get_ibx_todos: {
            description: "Fetch IBX todos from ibx.egeuysal.com/api/todos.",
            arguments: {
              today: "optional YYYY-MM-DD, defaults to local America/Chicago date",
              status: "optional all/open/done, default all",
              query: "optional text search over title/notes",
              limit: "optional 1-200, default 50",
            },
          },
        },
      },
      null,
      2,
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}

export async function handleMcpDevRequest(
  request: Connect.IncomingMessage,
  response: ServerResponse,
) {
  const webRequest = toWebRequest(request);
  const accept = webRequest.headers.get("accept") ?? "";

  if (webRequest.method === "GET" && !accept.includes("text/event-stream")) {
    await writeWebResponse(response, getMcpBrowserInfoResponse());
    return;
  }

  const origin = new URL(webRequest.url).origin;
  const server = createMcpServer((feed) => readSameOriginJsonFeed(origin, feed));
  const webResponse = await server.fetch(webRequest);

  await writeWebResponse(response, webResponse);
}
