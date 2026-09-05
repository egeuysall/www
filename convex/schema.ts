import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const kind = v.union(v.literal("blog"), v.literal("diary"), v.literal("photo"));

export default defineSchema({
  contentStats: defineTable({
    kind,
    slug: v.string(),
    contentKey: v.string(),
    viewCount: v.number(),
    likeCount: v.number(),
    commentCount: v.number(),
    updatedAt: v.number(),
  }).index("by_contentKey", ["contentKey"]),

  dailyViews: defineTable({
    kind,
    slug: v.string(),
    contentKey: v.string(),
    day: v.string(),
    actorHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_contentKey_and_day_and_actorHash", ["contentKey", "day", "actorHash"])
    .index("by_actor", ["actorHash"]),

  contentLikes: defineTable({
    kind,
    slug: v.string(),
    contentKey: v.string(),
    actorHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_contentKey_and_actorHash", ["contentKey", "actorHash"])
    .index("by_actor", ["actorHash"]),

  comments: defineTable({
    kind,
    slug: v.string(),
    contentKey: v.string(),
    actorHash: v.string(),
    rateHash: v.optional(v.string()),
    authorName: v.optional(v.string()),
    body: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    status: v.union(v.literal("visible"), v.literal("hidden"), v.literal("deleted")),
    likeCount: v.number(),
    reportCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_contentKey_and_status_and_createdAt", ["contentKey", "status", "createdAt"])
    .index("by_actor", ["actorHash"])
    .index("by_storage", ["storageId"]),

  commentLikes: defineTable({
    commentId: v.id("comments"),
    actorHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_commentId_and_actorHash", ["commentId", "actorHash"])
    .index("by_actor", ["actorHash"]),

  reports: defineTable({
    commentId: v.id("comments"),
    actorHash: v.string(),
    reason: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
  })
    .index("by_commentId_and_actorHash", ["commentId", "actorHash"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_comment", ["commentId"]),

  blockedActorHashes: defineTable({
    actorHash: v.string(),
    sourceCommentId: v.optional(v.id("comments")),
    createdAt: v.number(),
  }).index("by_actor", ["actorHash"]),

  blockedRateHashes: defineTable({
    rateHash: v.string(),
    sourceCommentId: v.optional(v.id("comments")),
    createdAt: v.number(),
  }).index("by_rate", ["rateHash"]),

  newsletterSubscribers: defineTable({
    email: v.string(),
    emailHash: v.string(),
    confirmTokenHash: v.string(),
    confirmExpiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("subscribed"), v.literal("unsubscribed")),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
  })
    .index("by_emailHash", ["emailHash"])
    .index("by_confirmTokenHash", ["confirmTokenHash"])
    .index("by_status", ["status"]),
});
