import { PROJECTS, SITE } from "@/config/site";
import {
  getPublishedBlogPosts,
  getPublishedDiaryEntries,
  getPublishedPhotoEntries,
} from "@/lib/content";
import { getPhotoEntrySlug } from "@/lib/content";

export type ArchiveKind = "blog" | "diary" | "photo" | "project" | "site" | "brain";

type ArchiveDocument = {
  kind: ArchiveKind;
  title: string;
  description: string;
  tags: string[];
  date: number;
  url: string;
  body: string;
};

type BrainRoute = {
  kind?: string;
  title?: string;
  routePath?: string;
  url?: string;
  markdownUrl?: string;
};

const STOP_WORDS = new Set(
  "a about after all also am an and any are as at be because before between both but by can could did do does for from get had has have how i if in into is it its just of on or our so than that the their them then there these they this to too was we were what when where which who why will with would you your".split(" "),
);
const BRAIN_ORIGIN = "https://brain.egeuysal.com";
const BRAIN_CACHE_MS = 30 * 60 * 1000;
const MAX_BRAIN_PAGES = 30;
const MAX_BRAIN_RESULTS = 4;
const MAX_CHUNK_LENGTH = 1_000;

let archivePromise: Promise<ArchiveDocument[]> | undefined;
let brainRoutesCache: { expiresAt: number; routes: BrainRoute[] } | undefined;
let brainRoutesPromise: Promise<BrainRoute[]> | undefined;
const brainDocumentCache = new Map<string, { expiresAt: number; body: string }>();

function stripMarkdown(value: string): string {
  return value
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_>#|~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function projectTags(value: string): string[] {
  const normalized = value.toLowerCase();
  return PROJECTS
    .filter((project) => new RegExp(`\\b${project.title.toLowerCase()}\\b`, "i").test(normalized))
    .map((project) => project.title.toLowerCase());
}

async function loadArchive(): Promise<ArchiveDocument[]> {
  const [blogs, diary, photos] = await Promise.all([
    getPublishedBlogPosts(),
    getPublishedDiaryEntries(),
    getPublishedPhotoEntries(),
  ]);
  const origin = SITE.url;
  const writing: ArchiveDocument[] = [
    ...blogs.map((post) => ({
      kind: "blog" as const,
      title: post.data.title,
      description: post.data.description,
      tags: [...post.data.tags, ...projectTags(`${post.data.title} ${post.body ?? ""}`)],
      date: post.data.publishedAt.getTime(),
      url: new URL(`/blog/${post.id}/`, origin).toString(),
      body: stripMarkdown(post.body ?? ""),
    })),
    ...diary.map((entry) => ({
      kind: "diary" as const,
      title: entry.data.summary,
      description: entry.data.summary,
      tags: [...entry.data.tags, ...projectTags(`${entry.data.summary} ${entry.body ?? ""}`)],
      date: entry.data.date.getTime(),
      url: new URL(`/diary/${entry.id}/`, origin).toString(),
      body: stripMarkdown(entry.body ?? ""),
    })),
    ...photos.map((entry) => ({
      kind: "photo" as const,
      title: entry.data.title,
      description: entry.data.description ?? entry.data.title,
      tags: [...entry.data.tags, ...projectTags(`${entry.data.title} ${entry.body ?? ""}`)],
      date: entry.data.publishedAt.getTime(),
      url: new URL(`/photo/${getPhotoEntrySlug(entry)}/`, origin).toString(),
      body: stripMarkdown(entry.body ?? ""),
    })),
  ];

  const projects = PROJECTS.map((project) => ({
    kind: "project" as const,
    title: project.title,
    description: project.summary,
    tags: [project.title.toLowerCase()],
    date: 0,
    url: project.url,
    body: `${project.title}: ${project.summary}. ${SITE.author.name} is the founder of this project.`,
  }));
  const site = {
    kind: "site" as const,
    title: SITE.author.name,
    description: SITE.description,
    tags: ["about", "founder", "work", "writing"],
    date: 0,
    url: new URL("/", origin).toString(),
    body: `${SITE.author.name} is a ${SITE.author.role}. ${SITE.description} This site connects projects, blog writing, diary entries, and photography.`,
  };

  return [...projects, site, ...writing];
}

function getArchive(): Promise<ArchiveDocument[]> {
  archivePromise ??= loadArchive();
  return archivePromise;
}

function termsFor(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu) ?? [])]
    .filter((term) => !STOP_WORDS.has(term));
}

function chunksFor(document: ArchiveDocument) {
  const paragraphs = document.body.split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/u).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > MAX_CHUNK_LENGTH) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${current ? " " : ""}${paragraph}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [document.description];
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of termsFor(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function bm25Score(
  queryTerms: string[],
  fields: Array<{ text: string; weight: number }>,
  documentFrequency: Map<string, number>,
  documentCount: number,
): number {
  let score = 0;
  for (const term of queryTerms) {
    const idf = Math.log(1 + (documentCount - (documentFrequency.get(term) ?? 0) + 0.5) / ((documentFrequency.get(term) ?? 0) + 0.5));
    for (const field of fields) {
      const count = termCounts(field.text).get(term) ?? 0;
      if (count) score += field.weight * idf * (count * 2.2) / (count + 1.2);
    }
  }
  return score;
}

function excerptAround(text: string, queryTerms: string[]): string {
  if (text.length <= 700) return text;
  const lowered = text.toLowerCase();
  const matchAt = queryTerms.map((term) => lowered.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const start = Math.max(0, (matchAt ?? 0) - 180);
  const end = Math.min(text.length, start + 700);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

async function fetchBrainRoutes(): Promise<BrainRoute[]> {
  if (brainRoutesCache && brainRoutesCache.expiresAt > Date.now()) return brainRoutesCache.routes;
  if (brainRoutesPromise) return brainRoutesPromise;

  brainRoutesPromise = (async () => {
    const first = await fetch(`${BRAIN_ORIGIN}/api/routes.json`, {
      signal: AbortSignal.timeout(3_500),
      redirect: "error",
    });
    if (!first.ok) throw new Error(`Brain route index returned ${first.status}`);
    const firstPage = await first.json() as {
      routes?: BrainRoute[];
      pagination?: { totalPages?: number };
    };
    const pageCount = Math.min(Math.max(firstPage.pagination?.totalPages ?? 1, 1), MAX_BRAIN_PAGES);
    const pages = await Promise.allSettled(Array.from({ length: pageCount - 1 }, async (_, index) => {
      const response = await fetch(`${BRAIN_ORIGIN}/api/routes/${index + 2}.json`, {
        signal: AbortSignal.timeout(3_500),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Brain route page returned ${response.status}`);
      return response.json() as Promise<{ routes?: BrainRoute[] }>;
    }));
    const routes = [firstPage, ...pages.flatMap((page) => page.status === "fulfilled" ? [page.value] : [])]
      .flatMap((page) => page.routes ?? []).filter((route) => {
      if (route.kind !== "doc" || !route.title || !route.markdownUrl) return false;
      try {
        return new URL(route.markdownUrl).origin === BRAIN_ORIGIN;
      } catch {
        return false;
      }
    });
    brainRoutesCache = { routes, expiresAt: Date.now() + BRAIN_CACHE_MS };
    return routes;
  })().catch(() => []).finally(() => {
    brainRoutesPromise = undefined;
  });

  return brainRoutesPromise;
}

async function fetchBrainDocument(route: BrainRoute): Promise<string> {
  const url = route.markdownUrl!;
  const cached = brainDocumentCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const response = await fetch(url, { signal: AbortSignal.timeout(3_500), redirect: "error" });
  if (!response.ok) throw new Error(`Brain document returned ${response.status}`);
  const body = stripMarkdown((await response.text()).slice(0, 18_000));
  brainDocumentCache.set(url, { body, expiresAt: Date.now() + BRAIN_CACHE_MS });
  return body;
}

async function searchBrain(queries: string[]) {
  const routes = await fetchBrainRoutes();
  if (!routes.length) return [];
  const ranked = routes.map((route) => {
    const title = route.title!.toLowerCase();
    const path = (route.routePath ?? "").toLowerCase();
    const score = queries.reduce((best, query) => Math.max(best, termsFor(query).reduce((total, term) =>
      total + (title.includes(term) ? 4 : path.includes(term) ? 1 : 0), 0)), 0);
    return { route, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_BRAIN_RESULTS);

  return Promise.all(ranked.map(async ({ route, score }) => {
    try {
      const body = await fetchBrainDocument(route);
      return {
        type: "brain" as const,
        title: route.title!,
        url: route.url ?? `${BRAIN_ORIGIN}/${route.routePath}`,
        excerpt: excerptAround(body, queries.flatMap(termsFor)),
        relevance: score * 2,
        source: "Brain reference library",
      };
    } catch {
      return null;
    }
  })).then((results) => results.filter((result): result is NonNullable<typeof result> => Boolean(result)));
}

export async function searchArchive(input: {
  query: string;
  relatedQueries?: string[];
  kinds?: ArchiveKind[];
  limit?: number;
}) {
  const query = input.query.trim();
  const queries = [query, ...(input.relatedQueries ?? []).slice(0, 3).map((item) => item.trim()).filter(Boolean)];
  const terms = [...new Set(queries.flatMap(termsFor))];
  const allowedKinds = new Set(input.kinds ?? ["blog", "diary", "photo", "project", "site", "brain"]);
  const documents = (await getArchive()).filter((document) => allowedKinds.has(document.kind));
  const chunks = documents.flatMap((document) => chunksFor(document).map((body) => ({ document, body })));
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(term, chunks.filter(({ body }) => termsFor(body).includes(term)).length);
  }

  const scored = chunks.map(({ document, body }) => {
    const fields = [
      { text: document.title, weight: 4 },
      { text: `${document.description} ${document.tags.join(" ")}`, weight: 2 },
      { text: body, weight: 1 },
    ];
    let relevance = queries.reduce((best, item) => Math.max(best, bm25Score(termsFor(item), fields, documentFrequency, chunks.length)), 0);
    const normalizedQuery = query.toLowerCase();
    if (normalizedQuery.length > 4 && document.title.toLowerCase().includes(normalizedQuery)) relevance += 8;
    return { document, body, relevance };
  }).filter((item) => item.relevance > 0).sort((a, b) => b.relevance - a.relevance || b.document.date - a.document.date);

  const selected = new Map<string, { document: ArchiveDocument; excerpt: string; relevance: number }>();
  for (const item of scored) {
    const existing = selected.get(item.document.url);
    if (existing) continue;
    selected.set(item.document.url, {
      document: item.document,
      excerpt: excerptAround(item.body, terms),
      relevance: item.relevance,
    });
    if (selected.size >= Math.min(input.limit ?? 6, 8)) break;
  }

  const localResults = [...selected.values()].map(({ document, excerpt, relevance }) => ({
    type: document.kind,
    title: document.title,
    date: document.date ? new Date(document.date).toISOString().slice(0, 10) : undefined,
    url: document.url,
    tags: document.tags,
    excerpt,
    relevance: Number(relevance.toFixed(2)),
  }));
  const brainResults = allowedKinds.has("brain") ? await searchBrain(queries).catch(() => []) : [];
  const results = [...localResults, ...brainResults]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, Math.min(input.limit ?? 6, 8));

  return { query, relatedQueries: queries.slice(1), results };
}
