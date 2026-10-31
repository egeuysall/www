import { createHash } from "node:crypto";

import { createGateway } from "@ai-sdk/gateway";
import { ConvexHttpClient } from "convex/browser";
import { embedMany, embed } from "ai";

import { api } from "../../convex/_generated/api";
import { PROJECTS, SITE } from "@/config/site";
import { getPublishedBlogPosts, getPublishedDiaryEntries, getPublishedPhotoEntries, getPhotoEntrySlug } from "@/lib/content";
import { searchArchive, type ArchiveKind } from "@/lib/archive-search";

const BRAIN_ORIGIN = "https://brain.egeuysal.com";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1_536;
const MAX_BRAIN_PAGES = 30;
const MAX_BRAIN_DOCUMENT_CHARS = 32_000;
const EMBEDDING_BATCH_SIZE = 32;
const CONVEX_BATCH_SIZE = 16;

type KnowledgeKind = ArchiveKind;
type KnowledgeSource = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  url: string;
  sourceLabel: string;
  body: string;
  tags: string[];
  publishedAt: number;
};
type KnowledgeChunk = KnowledgeSource & { chunkIndex: number; content: string };
type BrainRoute = { kind?: string; title?: string; routePath?: string; url?: string; markdownUrl?: string };

function envValue(name: string) {
  return process.env[name] || import.meta.env[name];
}

function cleanMarkdown(value: string) {
  return value
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<YouTubeVideo\b[^>]*\/?\s*>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_>#|~-]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tagsFor(value: string, tags: string[] = []) {
  const text = value.toLowerCase();
  const projectTags = PROJECTS
    .filter((project) => new RegExp(`\\b${project.title.toLowerCase()}\\b`, "i").test(text))
    .map((project) => project.title.toLowerCase());
  return [...new Set([...tags, ...projectTags].map((tag) => tag.toLowerCase().trim()).filter(Boolean))].slice(0, 32);
}

async function getLocalSources(): Promise<KnowledgeSource[]> {
  const [blogs, diary, photos] = await Promise.all([
    getPublishedBlogPosts(),
    getPublishedDiaryEntries(),
    getPublishedPhotoEntries(),
  ]);
  const sources: KnowledgeSource[] = [
    ...PROJECTS.map((project) => ({
      id: `project:${project.title.toLowerCase()}`,
      kind: "project" as const,
      title: project.title,
      url: project.url,
      sourceLabel: "Project overview",
      body: `${project.summary}. Built by ${SITE.author.name}.`,
      tags: [project.title.toLowerCase()],
      publishedAt: 0,
    })),
    {
      id: "site:about",
      kind: "site",
      title: SITE.author.name,
      url: SITE.url,
      sourceLabel: "About this site",
      body: `${SITE.author.name} is a ${SITE.author.role}. ${SITE.description}`,
      tags: ["about", "founder", "work", "writing"],
      publishedAt: 0,
    },
    ...blogs.map((post) => ({
      id: `blog:${post.id}`,
      kind: "blog" as const,
      title: post.data.title,
      url: new URL(`/blog/${post.id}/`, SITE.url).toString(),
      sourceLabel: "Ege's blog",
      body: cleanMarkdown(post.body ?? ""),
      tags: tagsFor(`${post.data.title} ${post.body ?? ""}`, post.data.tags),
      publishedAt: post.data.publishedAt.getTime(),
    })),
    ...diary.map((entry) => ({
      id: `diary:${entry.id}`,
      kind: "diary" as const,
      title: entry.data.summary,
      url: new URL(`/diary/${entry.id}/`, SITE.url).toString(),
      sourceLabel: "Ege's diary",
      body: cleanMarkdown(entry.body ?? ""),
      tags: tagsFor(`${entry.data.summary} ${entry.body ?? ""}`, entry.data.tags),
      publishedAt: entry.data.date.getTime(),
    })),
    ...photos.map((entry) => ({
      id: `photo:${getPhotoEntrySlug(entry)}`,
      kind: "photo" as const,
      title: entry.data.title,
      url: new URL(`/photo/${getPhotoEntrySlug(entry)}/`, SITE.url).toString(),
      sourceLabel: "Ege's photo archive",
      body: cleanMarkdown(`${entry.data.description ?? ""}\n\n${entry.body ?? ""}`),
      tags: tagsFor(`${entry.data.title} ${entry.data.description ?? ""} ${entry.body ?? ""}`, entry.data.tags),
      publishedAt: entry.data.publishedAt.getTime(),
    })),
  ];
  return sources;
}

async function fetchBrainIndex() {
  const response = await fetch(`${BRAIN_ORIGIN}/api/routes.json`, {
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Brain route index returned ${response.status}`);
  const first = await response.json() as {
    generatedAt?: string;
    routes?: BrainRoute[];
    pagination?: { totalPages?: number };
  };
  const pages = Math.min(Math.max(first.pagination?.totalPages ?? 1, 1), MAX_BRAIN_PAGES);
  const rest = await Promise.allSettled(Array.from({ length: pages - 1 }, async (_, index) => {
    const pageResponse = await fetch(`${BRAIN_ORIGIN}/api/routes/${index + 2}.json`, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!pageResponse.ok) throw new Error(`Brain route page returned ${pageResponse.status}`);
    return pageResponse.json() as Promise<{ routes?: BrainRoute[] }>;
  }));
  const routes = [first, ...rest.flatMap((page) => page.status === "fulfilled" ? [page.value] : [])]
    .flatMap((page) => page.routes ?? [])
    .filter((route) => route.kind === "doc" && route.title && route.routePath && route.markdownUrl)
    .filter((route) => {
      try {
        return new URL(route.markdownUrl!).origin === BRAIN_ORIGIN &&
          (!route.url || new URL(route.url).origin === BRAIN_ORIGIN);
      } catch { return false; }
    });
  return { generatedAt: first.generatedAt ?? "unknown", routes };
}

async function mapConcurrent<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  }));
  return results;
}

async function getBrainSources(routes: BrainRoute[]): Promise<KnowledgeSource[]> {
  const results = await mapConcurrent<BrainRoute, KnowledgeSource | null>(routes, 8, async (route): Promise<KnowledgeSource | null> => {
    try {
      const response = await fetch(route.markdownUrl!, {
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
      });
      if (!response.ok) return null;
      const body = cleanMarkdown(await readTextLimited(response, MAX_BRAIN_DOCUMENT_CHARS));
      if (!body) return null;
      return {
        id: `brain:${route.routePath}`,
        kind: "brain" as const,
        title: route.title!,
        url: route.url ?? `${BRAIN_ORIGIN}/${route.routePath}`,
        sourceLabel: "Brain reference library",
        body,
        tags: tagsFor(`${route.title} ${route.routePath} ${body.slice(0, 4_000)}`),
        publishedAt: 0,
      };
    } catch {
      return null;
    }
  });
  return results.filter((source): source is KnowledgeSource => source !== null);
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - bytes;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    bytes += chunk.byteLength;
    result += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel();
  return result + decoder.decode();
}

function chunkSources(sources: KnowledgeSource[]): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (const source of sources) {
    const paragraphs = source.body.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
    let current = "";
    let index = 0;
    const flush = () => {
      if (!current.trim()) return;
      chunks.push({ ...source, chunkIndex: index++, content: `${source.title}\n${current.trim()}`.slice(0, 1_950) });
      current = "";
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length > 1_500) {
        flush();
        for (let start = 0; start < paragraph.length; start += 1_350) {
          const part = paragraph.slice(start, start + 1_500).trim();
          if (part) chunks.push({ ...source, chunkIndex: index++, content: `${source.title}\n${part}`.slice(0, 1_950) });
        }
      } else if (current.length + paragraph.length > 1_500) {
        flush();
        current = paragraph;
      } else {
        current += `${current ? "\n\n" : ""}${paragraph}`;
      }
    }
    flush();
  }
  return chunks;
}

function requiredEnv(name: string) {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function convexClient() {
  return new ConvexHttpClient(requiredEnv("CONVEX_URL"));
}

function createEmbeddingGateway() {
  return createGateway({ apiKey: requiredEnv("AI_GATEWAY_API_KEY") });
}

async function clearGenerations(client: ConvexHttpClient, secret: string, generations: string[]) {
  for (const generation of generations) {
    for (;;) {
      const result = await client.mutation(api.knowledge.deleteGenerationBatch, { secret, generation });
      if (result.done) break;
    }
  }
}

export async function syncKnowledgeBase() {
  const secret = requiredEnv("AI_KNOWLEDGE_SECRET");
  const client = convexClient();
  const [localSources, brainIndex] = await Promise.all([getLocalSources(), fetchBrainIndex()]);
  const localRevision = createHash("sha256")
    .update(localSources.map((source) => `${source.id}\n${source.title}\n${source.url}\n${source.publishedAt}\n${source.tags.join(",")}\n${source.body}`).join("\n---\n"))
    .digest("hex");
  const brainRevision = createHash("sha256")
    .update(`${brainIndex.generatedAt}:${brainIndex.routes.map((route) => `${route.routePath}:${route.title}:${route.markdownUrl}`).join("\n")}`)
    .digest("hex");
  const generation = createHash("sha256").update(`${brainRevision}:${localRevision}`).digest("hex").slice(0, 40);
  const started = await client.mutation(api.knowledge.startSync, { secret, generation });
  await clearGenerations(client, secret, started.cleanupGenerations);
  if (started.skipped) return { skipped: true, sources: localSources.length + brainIndex.routes.length, chunks: 0 };

  const brainSources = await getBrainSources(brainIndex.routes);
  const chunks = chunkSources([...localSources, ...brainSources]);
  if (!chunks.length || brainSources.length === 0) {
    throw new Error("Knowledge sync did not retrieve Brain documents; keeping the current index active.");
  }

  const gateway = createEmbeddingGateway();
  let indexedChunks = 0;
  for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const embedded = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values: batch.map((chunk) => `${chunk.title}\n${chunk.tags.join(", ")}\n${chunk.content}`),
    });
    if (embedded.embeddings.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error("Embedding provider returned an unexpected vector size.");
    }
    for (let index = 0; index < batch.length; index += CONVEX_BATCH_SIZE) {
      const items = batch.slice(index, index + CONVEX_BATCH_SIZE).map((chunk, itemIndex) => {
        const embedding = embedded.embeddings[index + itemIndex];
        if (!embedding) throw new Error("Embedding provider omitted a vector.");
        return {
          sourceId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          kind: chunk.kind,
          title: chunk.title.slice(0, 240),
          url: chunk.url.slice(0, 600),
          sourceLabel: chunk.sourceLabel.slice(0, 80),
          content: chunk.content.slice(0, 2_000),
          tags: chunk.tags,
          publishedAt: chunk.publishedAt,
          embedding,
        };
      });
      await client.mutation(api.knowledge.addChunks, { secret, generation, items });
      indexedChunks += items.length;
    }
  }

  const activated = await client.mutation(api.knowledge.activateSync, { secret, generation });
  await clearGenerations(client, secret, activated.cleanupGenerations);
  return { skipped: false, sources: localSources.length + brainSources.length, chunks: indexedChunks };
}

export async function searchKnowledgeBase(input: {
  query: string;
  relatedQueries?: string[];
  kinds?: KnowledgeKind[];
  limit?: number;
}) {
  const key = envValue("AI_GATEWAY_API_KEY");
  const convexUrl = envValue("CONVEX_URL");
  const secret = envValue("AI_KNOWLEDGE_SECRET");
  if (!key || !convexUrl || !secret) return searchArchive(input);

  const queries = [input.query, ...(input.relatedQueries ?? []).slice(0, 3)];
  try {
    const gateway = createGateway({ apiKey: key });
    const embedded = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values: queries,
    });
    if (embedded.embeddings.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error("Embedding provider returned an unexpected vector size.");
    }
    const result = await new ConvexHttpClient(convexUrl).action(api.knowledge.search, {
      secret,
      embeddings: embedded.embeddings,
      query: input.query,
      relatedQueries: queries.slice(1),
      kinds: input.kinds ?? [],
      limit: input.limit ?? 8,
    });
    return result.indexed ? { query: input.query, relatedQueries: queries.slice(1), results: result.results } : searchArchive(input);
  } catch {
    return searchArchive(input);
  }
}
