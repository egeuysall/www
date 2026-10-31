import { ConvexError, v } from "convex/values";

import { env, action, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const EMBEDDING_DIMENSIONS = 1_536;
const MAX_CHUNKS_PER_WRITE = 16;
const knowledgeKind = v.union(
  v.literal("blog"),
  v.literal("diary"),
  v.literal("photo"),
  v.literal("project"),
  v.literal("site"),
  v.literal("brain"),
);
const knowledgeChunk = v.object({
  sourceId: v.string(),
  chunkIndex: v.number(),
  kind: knowledgeKind,
  title: v.string(),
  url: v.string(),
  sourceLabel: v.string(),
  content: v.string(),
  tags: v.array(v.string()),
  publishedAt: v.number(),
  embedding: v.array(v.float64()),
});
function requireSecret(secret: string) {
  if (!env.AI_KNOWLEDGE_SECRET || secret !== env.AI_KNOWLEDGE_SECRET) {
    throw new ConvexError("Unauthorized.");
  }
}

export const startSync = mutation({
  args: { secret: v.string(), generation: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(args.generation)) throw new ConvexError("Invalid generation.");
    const state = await ctx.db.query("aiKnowledgeState").withIndex("by_key", (q) => q.eq("key", "active")).unique();
    if (state?.activeGeneration === args.generation) {
      return { skipped: true, cleanupGenerations: state.cleanupGenerations };
    }
    const cleanupGenerations = [...new Set([
      ...(state?.cleanupGenerations ?? []),
      ...(state?.stagingGeneration && state.stagingGeneration !== state.activeGeneration ? [state.stagingGeneration] : []),
    ])].filter((generation) => generation !== state?.activeGeneration);
    if (state) {
      await ctx.db.patch(state._id, { stagingGeneration: args.generation, cleanupGenerations });
    } else {
      await ctx.db.insert("aiKnowledgeState", {
        key: "active",
        stagingGeneration: args.generation,
        cleanupGenerations,
      });
    }
    return { skipped: false, cleanupGenerations };
  },
});

export const addChunks = mutation({
  args: { secret: v.string(), generation: v.string(), items: v.array(knowledgeChunk) },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (args.items.length > MAX_CHUNKS_PER_WRITE) throw new ConvexError("Too many chunks in one write.");
    const state = await ctx.db.query("aiKnowledgeState").withIndex("by_key", (q) => q.eq("key", "active")).unique();
    if (state?.stagingGeneration !== args.generation) throw new ConvexError("Index generation is not active for writing.");
    for (const item of args.items) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) throw new ConvexError("Invalid embedding dimensions.");
      if (item.content.length > 2_000 || item.title.length > 240 || item.url.length > 600) {
        throw new ConvexError("Knowledge chunk exceeds limits.");
      }
      await ctx.db.insert("aiKnowledgeChunks", { ...item, generation: args.generation });
    }
    return { inserted: args.items.length };
  },
});

export const activateSync = mutation({
  args: { secret: v.string(), generation: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const state = await ctx.db.query("aiKnowledgeState").withIndex("by_key", (q) => q.eq("key", "active")).unique();
    if (!state || state.stagingGeneration !== args.generation) throw new ConvexError("Index generation is not ready.");
    const cleanupGenerations = [...new Set([
      ...state.cleanupGenerations,
      ...(state.activeGeneration && state.activeGeneration !== args.generation ? [state.activeGeneration] : []),
    ])].filter((generation) => generation !== args.generation);
    await ctx.db.patch(state._id, {
      activeGeneration: args.generation,
      stagingGeneration: undefined,
      cleanupGenerations,
    });
    return { cleanupGenerations };
  },
});

export const deleteGenerationBatch = mutation({
  args: { secret: v.string(), generation: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const state = await ctx.db.query("aiKnowledgeState").withIndex("by_key", (q) => q.eq("key", "active")).unique();
    if (!state || state.activeGeneration === args.generation || !state.cleanupGenerations.includes(args.generation)) {
      throw new ConvexError("Generation cannot be removed.");
    }
    const chunks = await ctx.db.query("aiKnowledgeChunks")
      .withIndex("by_generation", (q) => q.eq("generation", args.generation))
      .take(200);
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    const remaining = await ctx.db.query("aiKnowledgeChunks")
      .withIndex("by_generation", (q) => q.eq("generation", args.generation))
      .first();
    if (!remaining) {
      await ctx.db.patch(state._id, {
        cleanupGenerations: state.cleanupGenerations.filter((generation) => generation !== args.generation),
      });
    }
    return { deleted: chunks.length, done: !remaining };
  },
});

export const getActiveGeneration = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const state = await ctx.db.query("aiKnowledgeState").withIndex("by_key", (q) => q.eq("key", "active")).unique();
    return state?.activeGeneration ?? null;
  },
});

export const getByIds = internalQuery({
  args: { ids: v.array(v.id("aiKnowledgeChunks")) },
  handler: async (ctx, args): Promise<Array<Doc<"aiKnowledgeChunks"> | null>> =>
    Promise.all(args.ids.map((id) => ctx.db.get(id))),
});

export const searchLexical = internalQuery({
  args: { generation: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<Array<Doc<"aiKnowledgeChunks">>> => ctx.db.query("aiKnowledgeChunks")
    .withSearchIndex("search_content", (q) => q.search("content", args.query).eq("generation", args.generation))
    .take(40),
});

export const search = action({
  args: {
    secret: v.string(),
    embeddings: v.array(v.array(v.float64())),
    query: v.string(),
    relatedQueries: v.array(v.string()),
    kinds: v.array(knowledgeKind),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<{
    indexed: boolean;
    results: Array<{
      type: "blog" | "diary" | "photo" | "project" | "site" | "brain";
      title: string;
      date?: string;
      url: string;
      source: string;
      tags: string[];
      excerpt: string;
      relevance: number;
    }>;
  }> => {
    requireSecret(args.secret);
    if (!args.embeddings.length || args.embeddings.length > 4 || args.embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)) {
      throw new ConvexError("Invalid query embedding.");
    }
    if (args.query.length > 180 || args.relatedQueries.length > 3 || args.relatedQueries.some((query) => query.length > 180)) {
      throw new ConvexError("Search query exceeds limits.");
    }
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10) throw new ConvexError("Invalid result limit.");
    const generation: string | null = await ctx.runQuery(internal.knowledge.getActiveGeneration, {});
    if (!generation) return { results: [], indexed: false };
    const queries = [args.query, ...args.relatedQueries].slice(0, args.embeddings.length);
    const semanticQueries: Array<Promise<Array<{ _id: Id<"aiKnowledgeChunks">; _score: number }>>> =
      args.embeddings.map((vector) => ctx.vectorSearch("aiKnowledgeChunks", "by_embedding", {
        vector,
        limit: 32,
        filter: (q) => q.eq("generation", generation),
      }));
    const lexicalQueries: Array<Promise<Array<Doc<"aiKnowledgeChunks">>>> =
      queries.map((query) => ctx.runQuery(internal.knowledge.searchLexical, { generation, query }));
    const [semanticResults, lexicalResults] = await Promise.all([
      Promise.all(semanticQueries),
      Promise.all(lexicalQueries),
    ]);

    const ranks = new Map<string, { id: (typeof semanticResults)[number][number]["_id"]; score: number }>();
    const addRank = (id: (typeof semanticResults)[number][number]["_id"], rank: number, weight: number) => {
      const key = String(id);
      const current = ranks.get(key) ?? { id, score: 0 };
      current.score += weight / (60 + rank);
      ranks.set(key, current);
    };
    semanticResults.forEach((hits, queryIndex) => hits.forEach((hit, rank) => addRank(hit._id, rank + 1, queryIndex === 0 ? 2 : 1)));
    lexicalResults.forEach((hits, queryIndex) => hits.forEach((hit, rank) => addRank(hit._id, rank + 1, queryIndex === 0 ? 1.5 : 0.75)));

    const ranked = [...ranks.values()].sort((a, b) => b.score - a.score).slice(0, 80);
    const documents = await ctx.runQuery(internal.knowledge.getByIds, { ids: ranked.map((item) => item.id) });
    const hydrated = ranked.flatMap((item, index) => {
      const document = documents[index];
      if (!document || (args.kinds.length > 0 && !args.kinds.includes(document.kind))) return [];
      return [{ document, score: item.score }];
    });
    const uniqueSources = [...new Map(hydrated.map((item) => [item.document.url, item])).values()];

    const results = uniqueSources.map((item, index) => {
      const relationships = uniqueSources.slice(0, 20).filter((other, otherIndex) =>
        otherIndex !== index && other.document.kind !== item.document.kind &&
        item.document.tags.some((tag) => other.document.tags.includes(tag)),
      ).length;
      return {
        type: item.document.kind,
        title: item.document.title,
        date: item.document.publishedAt ? new Date(item.document.publishedAt).toISOString().slice(0, 10) : undefined,
        url: item.document.url,
        source: item.document.sourceLabel,
        tags: item.document.tags,
        excerpt: item.document.content.slice(0, 1_200),
        relevance: Number((item.score + Math.min(relationships, 4) * 0.001).toFixed(4)),
      };
    }).sort((a, b) => b.relevance - a.relevance).slice(0, Math.max(1, Math.min(args.limit, 10)));

    return { results, indexed: true };
  },
});
