import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const kindArg = v.union(v.literal("blog"), v.literal("diary"), v.literal("photo"));
const itemArg = v.object({ kind: kindArg, slug: v.string() });

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTOR_RE = /^[a-f0-9]{64}$/;
const MAX_AUTHOR = 80;
const MAX_BODY = 2_000;
const MAX_REASON = 500;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const limits = new RateLimiter(components.rateLimiter, {
  view: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 },
  like: { kind: "fixed window", rate: 60, period: HOUR },
  comment: { kind: "fixed window", rate: 5, period: HOUR },
  upload: { kind: "fixed window", rate: 12, period: 10 * MINUTE },
  deleteUpload: { kind: "fixed window", rate: 30, period: 10 * MINUTE },
  report: { kind: "fixed window", rate: 10, period: HOUR },
  adminLogin: { kind: "fixed window", rate: 10, period: HOUR },
});

type Kind = "blog" | "diary" | "photo";
type Ctx = QueryCtx | MutationCtx;
type LimitName = "view" | "like" | "comment" | "upload" | "deleteUpload" | "report" | "adminLogin";

export function contentKey(kind: Kind, slug: string) {
  if (!SLUG_RE.test(slug) || slug.length > 120) {
    throw new ConvexError("Invalid content slug.");
  }
  return `${kind}:${slug}`;
}

export function cleanText(value: string | undefined, max: number, field: string) {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  if (trimmed.length > max) throw new ConvexError(`${field} is too long.`);
  return trimmed;
}

function requireSecret(secret: string) {
  if (secret !== env.INTERACTION_WRITE_SECRET) throw new ConvexError("Unauthorized.");
}

function requireActor(actorHash: string) {
  if (!ACTOR_RE.test(actorHash)) throw new ConvexError("Invalid actor.");
}

async function requireWritableActor(ctx: Ctx, actorHash: string, rateHash: string) {
  requireActor(actorHash);
  requireActor(rateHash);
  const blocked = await ctx.db
    .query("blockedActorHashes")
    .withIndex("by_actor", (q) => q.eq("actorHash", actorHash))
    .first();
  if (blocked) throw new ConvexError("Actor is blocked.");
  const blockedRate = await ctx.db
    .query("blockedRateHashes")
    .withIndex("by_rate", (q) => q.eq("rateHash", rateHash))
    .first();
  if (blockedRate) throw new ConvexError("Actor is blocked.");
}

async function limit(ctx: MutationCtx, actorHash: string, name: LimitName) {
  await limits.limit(ctx, name, { key: actorHash, throws: true });
}

async function getStats(ctx: Ctx, key: string) {
  return await ctx.db
    .query("contentStats")
    .withIndex("by_contentKey", (q) => q.eq("contentKey", key))
    .first();
}

async function ensureStats(ctx: MutationCtx, kind: Kind, slug: string) {
  const key = contentKey(kind, slug);
  const existing = await getStats(ctx, key);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("contentStats", {
    kind,
    slug,
    contentKey: key,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

async function imageUrl(ctx: Ctx, storageId: Id<"_storage"> | undefined) {
  return storageId ? await ctx.storage.getUrl(storageId) : null;
}

async function assertImage(ctx: MutationCtx, storageId: Id<"_storage">) {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (!metadata) throw new ConvexError("Image not found.");
  if (
    !metadata.contentType ||
    !IMAGE_TYPES.has(metadata.contentType) ||
    metadata.size > MAX_IMAGE_BYTES
  ) {
    await ctx.storage.delete(storageId);
    throw new ConvexError("Image must be jpeg, png, webp, or gif and 4MB or smaller.");
  }
}

async function deleteCommentImage(ctx: MutationCtx, comment: Doc<"comments">) {
  if (comment.storageId) await ctx.storage.delete(comment.storageId);
}

async function resolveReports(ctx: MutationCtx, commentId: Id<"comments">) {
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .collect();
  await Promise.all(
    reports
      .filter((report) => report.status === "open")
      .map((report) => ctx.db.patch(report._id, { status: "resolved" })),
  );
}

async function deleteComment(ctx: MutationCtx, comment: Doc<"comments">) {
  const now = Date.now();
  if (comment.status === "visible") {
    const stats = await ensureStats(ctx, comment.kind, comment.slug);
    await ctx.db.patch(stats._id, {
      commentCount: Math.max(0, stats.commentCount - 1),
      updatedAt: now,
    });
  }
  await deleteCommentImage(ctx, comment);
  await resolveReports(ctx, comment._id);
  await ctx.db.patch(comment._id, {
    body: undefined,
    storageId: undefined,
    status: "deleted",
    likeCount: 0,
    updatedAt: now,
  });
}

function dayKey(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

export const getStatsBatch = query({
  args: { items: v.array(itemArg) },
  handler: async (ctx, args) => {
    if (args.items.length > 50) throw new ConvexError("Too many items.");
    return await Promise.all(
      args.items.map(async (item) => {
        const stats = await getStats(ctx, contentKey(item.kind, item.slug));
        return {
          kind: item.kind,
          slug: item.slug,
          viewCount: stats?.viewCount ?? 0,
          likeCount: stats?.likeCount ?? 0,
          commentCount: stats?.commentCount ?? 0,
        };
      }),
    );
  },
});

export const listComments = query({
  args: { kind: kindArg, slug: v.string() },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_contentKey_and_status_and_createdAt", (q) =>
        q.eq("contentKey", contentKey(args.kind, args.slug)).eq("status", "visible"),
      )
      .order("desc")
      .take(100);
    return await Promise.all(
      comments.map(async (comment) => ({
        _id: comment._id,
        authorName: comment.authorName ?? null,
        body: comment.body ?? null,
        imageUrl: await imageUrl(ctx, comment.storageId),
        likeCount: comment.likeCount,
        createdAt: comment.createdAt,
      })),
    );
  },
});

export const listReports = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "open"))
      .order("desc")
      .take(100);
    return await Promise.all(
      reports.map(async (report) => {
        const comment = await ctx.db.get(report.commentId);
        return {
          reportId: report._id,
          reason: report.reason,
          createdAt: report.createdAt,
          comment: comment
            ? {
                _id: comment._id,
                kind: comment.kind,
                slug: comment.slug,
                authorName: comment.authorName ?? null,
                body: comment.body ?? null,
                imageUrl: await imageUrl(ctx, comment.storageId),
                status: comment.status,
                likeCount: comment.likeCount,
                reportCount: comment.reportCount,
                createdAt: comment.createdAt,
              }
            : null,
        };
      }),
    );
  },
});

export const getViewerState = query({
  args: { secret: v.string(), kind: kindArg, slug: v.string(), actorHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireActor(args.actorHash);
    const key = contentKey(args.kind, args.slug);
    const contentLike = await ctx.db
      .query("contentLikes")
      .withIndex("by_contentKey_and_actorHash", (q) =>
        q.eq("contentKey", key).eq("actorHash", args.actorHash),
      )
      .first();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_contentKey_and_status_and_createdAt", (q) =>
        q.eq("contentKey", key).eq("status", "visible"),
      )
      .take(100);
    const likedCommentIds = (
      await Promise.all(
        comments.map(async (comment) => {
          const like = await ctx.db
            .query("commentLikes")
            .withIndex("by_commentId_and_actorHash", (q) =>
              q.eq("commentId", comment._id).eq("actorHash", args.actorHash),
            )
            .first();
          return like ? comment._id : null;
        }),
      )
    ).filter((id): id is Id<"comments"> => id !== null);
    const ownedCommentIds = comments
      .filter((comment) => comment.actorHash === args.actorHash)
      .map((comment) => comment._id);
    return { contentLiked: contentLike !== null, likedCommentIds, ownedCommentIds };
  },
});

export const recordView = mutation({
  args: { secret: v.string(), kind: kindArg, slug: v.string(), actorHash: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "view");
    const key = contentKey(args.kind, args.slug);
    const now = Date.now();
    const day = dayKey(now);
    const seen = await ctx.db
      .query("dailyViews")
      .withIndex("by_contentKey_and_day_and_actorHash", (q) =>
        q.eq("contentKey", key).eq("day", day).eq("actorHash", args.actorHash),
      )
      .first();
    const stats = await ensureStats(ctx, args.kind, args.slug);
    if (seen) return { counted: false, viewCount: stats.viewCount };
    await ctx.db.insert("dailyViews", {
      kind: args.kind,
      slug: args.slug,
      contentKey: key,
      day,
      actorHash: args.actorHash,
      createdAt: now,
    });
    await ctx.db.patch(stats._id, { viewCount: stats.viewCount + 1, updatedAt: now });
    return { counted: true, viewCount: stats.viewCount + 1 };
  },
});

// One-time cleanup for the old synthetic counters. It stays internal so it
// cannot be called through the public engagement API.
export const resetViewCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const views = await ctx.db.query("dailyViews").take(100);
    await Promise.all(views.map((view) => ctx.db.delete(view._id)));

    if (views.length === 100) {
      await ctx.scheduler.runAfter(0, internal.interactions.resetViewCounts, {});
      return { phase: "views", deletedViews: views.length, resetStats: false };
    }

    const stats = await ctx.db.query("contentStats").take(200);
    const now = Date.now();
    await Promise.all(
      stats
        .filter((stat) => stat.viewCount !== 0)
        .map((stat) => ctx.db.patch(stat._id, { viewCount: 0, updatedAt: now })),
    );
    return { phase: "complete", deletedViews: views.length, resetStats: true };
  },
});

export const toggleContentLike = mutation({
  args: { secret: v.string(), kind: kindArg, slug: v.string(), actorHash: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "like");
    const key = contentKey(args.kind, args.slug);
    const now = Date.now();
    const stats = await ensureStats(ctx, args.kind, args.slug);
    const existing = await ctx.db
      .query("contentLikes")
      .withIndex("by_contentKey_and_actorHash", (q) =>
        q.eq("contentKey", key).eq("actorHash", args.actorHash),
      )
      .first();
    const delta = existing ? -1 : 1;
    if (existing) await ctx.db.delete(existing._id);
    else {
      await ctx.db.insert("contentLikes", {
        kind: args.kind,
        slug: args.slug,
        contentKey: key,
        actorHash: args.actorHash,
        createdAt: now,
      });
    }
    const likeCount = Math.max(0, stats.likeCount + delta);
    await ctx.db.patch(stats._id, { likeCount, updatedAt: now });
    return { liked: !existing, likeCount };
  },
});

export const toggleCommentLike = mutation({
  args: { secret: v.string(), commentId: v.id("comments"), actorHash: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "like");
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status !== "visible") throw new ConvexError("Comment not found.");
    const existing = await ctx.db
      .query("commentLikes")
      .withIndex("by_commentId_and_actorHash", (q) =>
        q.eq("commentId", args.commentId).eq("actorHash", args.actorHash),
      )
      .first();
    const delta = existing ? -1 : 1;
    if (existing) await ctx.db.delete(existing._id);
    else {
      await ctx.db.insert("commentLikes", {
        commentId: args.commentId,
        actorHash: args.actorHash,
        createdAt: Date.now(),
      });
    }
    const likeCount = Math.max(0, comment.likeCount + delta);
    await ctx.db.patch(args.commentId, { likeCount, updatedAt: Date.now() });
    return { liked: !existing, likeCount };
  },
});

export const createComment = mutation({
  args: {
    secret: v.string(),
    kind: kindArg,
    slug: v.string(),
    actorHash: v.string(),
    rateHash: v.string(),
    authorName: v.string(),
    body: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "comment");
    const key = contentKey(args.kind, args.slug);
    const authorName = cleanText(args.authorName, MAX_AUTHOR, "Author name") ?? "Anonymous";
    const body = cleanText(args.body, MAX_BODY, "Comment");
    if (!body && !args.storageId) throw new ConvexError("Comment body or image is required.");
    if (args.storageId) await assertImage(ctx, args.storageId);
    const now = Date.now();
    const id = await ctx.db.insert("comments", {
      kind: args.kind,
      slug: args.slug,
      contentKey: key,
      actorHash: args.actorHash,
      rateHash: args.rateHash,
      authorName,
      body,
      storageId: args.storageId,
      status: "visible",
      likeCount: 0,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const stats = await ensureStats(ctx, args.kind, args.slug);
    await ctx.db.patch(stats._id, { commentCount: stats.commentCount + 1, updatedAt: now });
    return { commentId: id, commentCount: stats.commentCount + 1 };
  },
});

export const generateUploadUrl = mutation({
  args: { secret: v.string(), actorHash: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "upload");
    return await ctx.storage.generateUploadUrl();
  },
});

export const deleteUpload = mutation({
  args: { secret: v.string(), storageId: v.id("_storage"), actorHash: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "deleteUpload");
    const attached = await ctx.db
      .query("comments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (attached && attached.status !== "deleted") throw new ConvexError("Image is attached to a comment.");
    await ctx.storage.delete(args.storageId);
    return { deleted: true };
  },
});

export const reportComment = mutation({
  args: {
    secret: v.string(),
    commentId: v.id("comments"),
    actorHash: v.string(),
    rateHash: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await requireWritableActor(ctx, args.actorHash, args.rateHash);
    await limit(ctx, args.rateHash, "report");
    const reason = cleanText(args.reason, MAX_REASON, "Reason");
    if (!reason) throw new ConvexError("Reason is required.");
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status !== "visible") throw new ConvexError("Comment not found.");
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_commentId_and_actorHash", (q) =>
        q.eq("commentId", args.commentId).eq("actorHash", args.actorHash),
      )
      .first();
    if (existing) return { reported: false, reportCount: comment.reportCount };
    await ctx.db.insert("reports", {
      commentId: args.commentId,
      actorHash: args.actorHash,
      reason,
      status: "open",
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.commentId, {
      reportCount: comment.reportCount + 1,
      updatedAt: Date.now(),
    });
    return { reported: true, reportCount: comment.reportCount + 1 };
  },
});

export const deleteOwnComment = mutation({
  args: { secret: v.string(), commentId: v.id("comments"), actorHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireActor(args.actorHash);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status !== "visible") throw new ConvexError("Comment not found.");
    if (comment.actorHash !== args.actorHash) throw new ConvexError("You can only delete your own comment.");

    await deleteComment(ctx, comment);
    return { deleted: true };
  },
});

export const checkAdminLogin = mutation({
  args: { secret: v.string(), rateHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireActor(args.rateHash);
    await limit(ctx, args.rateHash, "adminLogin");
    return { allowed: true };
  },
});

export const deleteReportedComment = mutation({
  args: { secret: v.string(), commentId: v.id("comments") },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status === "deleted") throw new ConvexError("Comment not found.");
    await deleteComment(ctx, comment);
    return { status: "deleted" };
  },
});
