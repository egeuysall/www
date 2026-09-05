import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { env, mutation, query } from "./_generated/server";

const HASH_RE = /^[a-f0-9]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1_000;
const limits = new RateLimiter(components.rateLimiter, {
  subscribe: { kind: "fixed window", rate: 3, period: HOUR },
});

function requireSecret(secret: string) {
  if (secret !== env.INTERACTION_WRITE_SECRET) throw new ConvexError("Unauthorized.");
}

function requireHash(value: string, field: string) {
  if (!HASH_RE.test(value)) throw new ConvexError(`Invalid ${field}.`);
}

function requireEmail(email: string) {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ConvexError("Invalid email.");
}

export const subscribe = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    emailHash: v.string(),
    confirmTokenHash: v.string(),
    rateHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireEmail(args.email);
    requireHash(args.emailHash, "email hash");
    requireHash(args.confirmTokenHash, "confirmation token");
    requireHash(args.rateHash, "rate hash");
    await limits.limit(ctx, "subscribe", { key: args.rateHash, throws: true });

    const existing = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_emailHash", (q) => q.eq("emailHash", args.emailHash))
      .first();
    if (existing?.status === "subscribed") return { status: "subscribed" as const };

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        confirmTokenHash: args.confirmTokenHash,
        confirmExpiresAt: now + CONFIRMATION_TTL_MS,
        status: "pending",
        createdAt: now,
        confirmedAt: undefined,
        unsubscribedAt: undefined,
      });
    } else {
      await ctx.db.insert("newsletterSubscribers", {
        email: args.email,
        emailHash: args.emailHash,
        confirmTokenHash: args.confirmTokenHash,
        confirmExpiresAt: now + CONFIRMATION_TTL_MS,
        status: "pending",
        createdAt: now,
      });
    }

    return { status: "pending" as const };
  },
});

export const confirm = mutation({
  args: { secret: v.string(), confirmTokenHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireHash(args.confirmTokenHash, "confirmation token");
    const subscriber = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_confirmTokenHash", (q) => q.eq("confirmTokenHash", args.confirmTokenHash))
      .first();
    if (!subscriber || subscriber.confirmExpiresAt < Date.now()) return { confirmed: false };
    if (subscriber.status !== "subscribed") {
      await ctx.db.patch(subscriber._id, {
        status: "subscribed",
        confirmedAt: Date.now(),
        confirmExpiresAt: 0,
        unsubscribedAt: undefined,
      });
    }
    return { confirmed: true };
  },
});

export const unsubscribe = mutation({
  args: { secret: v.string(), emailHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireHash(args.emailHash, "email hash");
    const subscriber = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_emailHash", (q) => q.eq("emailHash", args.emailHash))
      .first();
    if (!subscriber) return { unsubscribed: false };
    await ctx.db.patch(subscriber._id, {
      status: "unsubscribed",
      confirmExpiresAt: 0,
      unsubscribedAt: Date.now(),
    });
    return { unsubscribed: true };
  },
});

export const listSubscribed = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const subscribers = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "subscribed"))
      .take(1_000);
    return subscribers.map(({ email }) => email);
  },
});
