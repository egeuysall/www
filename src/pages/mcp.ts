import { createMcpServer } from "../mcp/server";

export const prerender = false;

type GetContext = {
  site: URL | undefined;
  request: Request;
};

export async function GET({ request }: GetContext): Promise<Response> {
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return handleMcpRequest(request);
  }

  return new Response(
    JSON.stringify({
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
            routePrefix:
              "optional prefix such as resources/articles or resources/posts",
            limit: "optional 1-200, default 50",
            maxPages: "optional 1-100, default 50",
          },
        },
        fetch_brain_resource: {
          description:
            "Fetch markdown from brain.egeuysal.com. Accepts markdownUrl, page URL, routePath, or /resources path.",
          arguments: {
            urlOrPath:
              "for example https://brain.egeuysal.com/resources/articles/2026-03-21-133927.md",
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
            today:
              "optional YYYY-MM-DD, defaults to local America/Chicago date",
            status: "optional all/open/done, default all",
            query: "optional text search over title/notes",
            limit: "optional 1-200, default 50",
          },
        },
      },
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export async function POST({
  request,
}: {
  request: Request;
}): Promise<Response> {
  return handleMcpRequest(request);
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const server = createMcpServer(async (feed) => {
    const response = await fetch(new URL(`/${feed}.json`, origin));
    if (!response.ok) {
      throw new Error(`Failed to fetch /${feed}.json: HTTP ${response.status}`);
    }
    return response.text();
  });

  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");

  return server.fetch(new Request(request, { headers }));
}
