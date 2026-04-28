import { z } from "zod";

const BRAIN_HOST = "brain.egeuysal.com";
const BRAIN_ORIGIN = `https://${BRAIN_HOST}`;
const BRAIN_ROUTES_URL = `${BRAIN_ORIGIN}/api/routes.json`;
const BRI_NOTES_URL = "https://bri.fyi/api/notes";
const BRI_API_KEY = "bri_YsX0UP4M.ntpkGbs5GIrU3Cu7PqjJjZsCdtn4Tfby";
const IBX_TODOS_URL = "https://ibx.egeuysal.com/api/todos";
const IBX_API_KEY = "iak_BMr7A7BP0cslD6Pg_FOgNVfYRvNp041V";
const MAX_LIMIT = 200;

export const brainFetchSchema = z.object({
  urlOrPath: z
    .string()
    .describe(
      "A brain.egeuysal.com URL, /resources/... path, routePath, or markdownUrl.",
    ),
});

export const brainSearchSchema = z.object({
  query: z.string().optional().describe("Case-insensitive title/path/sourcePath search."),
  routePrefix: z
    .string()
    .optional()
    .describe("Optional route prefix, for example resources/articles or resources/posts."),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(50).optional(),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .optional()
    .describe("Maximum paginated route pages to fetch from brain.egeuysal.com."),
});

export const briNotesSchema = z.object({
  query: z.string().optional().describe("Case-insensitive search over title, slug, and content."),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(50).optional(),
});

export const ibxTodosSchema = z.object({
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD date filter. Defaults to today in America/Chicago."),
  status: z.enum(["all", "open", "done"]).default("all").optional(),
  query: z.string().optional().describe("Case-insensitive search over title and notes."),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(50).optional(),
});

export type BrainRoute = {
  href: string;
  kind: string;
  markdownHref?: string;
  markdownUrl?: string;
  routePath: string;
  sourcePath?: string;
  title?: string;
  url: string;
};

type BrainRoutesResponse = {
  pagination?: {
    nextUrl?: string | null;
    page?: number;
    totalItems?: number;
    totalPages?: number;
  };
  routes?: BrainRoute[];
};

type BriNote = {
  content?: string;
  slug?: string;
  title?: string;
  [key: string]: unknown;
};

type IbxTodo = {
  notes?: string | null;
  status?: string;
  title?: string;
  [key: string]: unknown;
};

function getLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 50, 1), MAX_LIMIT);
}

function includesQuery(value: string, query: string | undefined) {
  return !query || value.toLowerCase().includes(query.toLowerCase());
}

function getChicagoDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Chicago",
    year: "numeric",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function assertOk(response: Response, label: string) {
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`);
  }
}

export function toBrainMarkdownUrl(urlOrPath: string): string {
  const value = urlOrPath.trim();

  if (!value) {
    throw new Error("Brain URL/path cannot be empty.");
  }

  if (value.startsWith("/")) {
    return toBrainMarkdownUrl(`${BRAIN_ORIGIN}${value}`);
  }

  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return toBrainMarkdownUrl(`${BRAIN_ORIGIN}/${value}`);
  }

  const url = new URL(value);

  if (url.hostname !== BRAIN_HOST) {
    throw new Error(`Only ${BRAIN_HOST} URLs are supported.`);
  }

  if (url.pathname.endsWith(".md")) {
    return url.toString();
  }

  if (url.pathname.endsWith(".mdx")) {
    url.pathname = url.pathname.replace(/\.mdx$/, ".md");
    return url.toString();
  }

  if (url.pathname.startsWith("/api/routes")) {
    throw new Error("Use search_brain_resources for the paginated routes API.");
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}.md`;

  return url.toString();
}

export async function fetchBrainResource(args: z.infer<typeof brainFetchSchema>) {
  const markdownUrl = toBrainMarkdownUrl(args.urlOrPath);
  const response = await fetch(markdownUrl);
  assertOk(response, "Brain markdown fetch");

  return response.text();
}

export async function fetchBrainRoutes(maxPages = 50): Promise<BrainRoute[]> {
  const routes: BrainRoute[] = [];
  let nextUrl: string | null | undefined = BRAIN_ROUTES_URL;
  let pagesFetched = 0;

  while (nextUrl && pagesFetched < maxPages) {
    const response = await fetch(nextUrl);
    assertOk(response, "Brain routes fetch");

    const payload = (await response.json()) as BrainRoutesResponse;
    routes.push(...(payload.routes ?? []));
    nextUrl = payload.pagination?.nextUrl;
    pagesFetched += 1;
  }

  return routes;
}

function routeMatchesQuery(route: BrainRoute, query: string | undefined) {
  return includesQuery(
    `${route.title ?? ""} ${route.routePath} ${route.sourcePath ?? ""} ${route.markdownUrl ?? ""}`,
    query,
  );
}

function routeMatchesPrefix(route: BrainRoute, routePrefix: string | undefined) {
  if (!routePrefix) {
    return true;
  }

  const prefix = routePrefix.replace(/^\/+/, "");

  return route.routePath.startsWith(prefix);
}

export async function searchBrainResources(args: z.infer<typeof brainSearchSchema>) {
  const limit = getLimit(args.limit);
  const routes = await fetchBrainRoutes(args.maxPages ?? 50);
  const matches = routes
    .filter((route) => route.kind === "doc")
    .filter((route) => routeMatchesPrefix(route, args.routePrefix))
    .filter((route) => routeMatchesQuery(route, args.query));

  return JSON.stringify(
    {
      count: matches.length,
      items: matches.slice(0, limit),
      returned: Math.min(matches.length, limit),
      source: BRAIN_ROUTES_URL,
    },
    null,
    2,
  );
}

export async function fetchBriNotes(args: z.infer<typeof briNotesSchema>) {
  const response = await fetch(BRI_NOTES_URL, {
    headers: {
      Authorization: `Bearer ${BRI_API_KEY}`,
    },
  });
  assertOk(response, "Bri notes fetch");

  const payload = await response.json();
  const notes = Array.isArray(payload?.data) ? (payload.data as BriNote[]) : [];
  const filtered = notes.filter((note) =>
    includesQuery(`${note.title ?? ""} ${note.slug ?? ""} ${note.content ?? ""}`, args.query),
  );
  const limit = getLimit(args.limit);

  return JSON.stringify(
    {
      count: filtered.length,
      items: filtered.slice(0, limit),
      returned: Math.min(filtered.length, limit),
    },
    null,
    2,
  );
}

export async function fetchIbxTodos(args: z.infer<typeof ibxTodosSchema>) {
  const today = args.today ?? getChicagoDateKey();
  const url = new URL(IBX_TODOS_URL);
  url.searchParams.set("today", today);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${IBX_API_KEY}`,
    },
  });
  assertOk(response, "IBX todos fetch");

  const payload = await response.json();
  const todos = Array.isArray(payload?.todos) ? (payload.todos as IbxTodo[]) : [];
  const status = args.status ?? "all";
  const filtered = todos.filter((todo) => {
    const statusMatches = status === "all" || todo.status === status;
    const queryMatches = includesQuery(`${todo.title ?? ""} ${todo.notes ?? ""}`, args.query);

    return statusMatches && queryMatches;
  });
  const limit = getLimit(args.limit);

  return JSON.stringify(
    {
      count: filtered.length,
      items: filtered.slice(0, limit),
      returned: Math.min(filtered.length, limit),
      today,
    },
    null,
    2,
  );
}
