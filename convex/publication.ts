import { ConvexError, v } from "convex/values";
import { env, mutation } from "./_generated/server";

const DELIVERY_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1_000;

function requireSecret(secret: string) {
  if (secret !== env.INTERACTION_WRITE_SECRET) throw new ConvexError("Unauthorized.");
}

function requireDeliveryId(deliveryId: string) {
  if (!DELIVERY_RE.test(deliveryId)) throw new ConvexError("Invalid delivery.");
}

export const claimDelivery = mutation({
  args: { secret: v.string(), deliveryId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireDeliveryId(args.deliveryId);

    const existing = await ctx.db
      .query("publicationDeliveries")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
      .first();
    const now = Date.now();
    if (existing?.status === "complete") return { claimed: false };
    if (existing && existing.startedAt > now - CLAIM_TIMEOUT_MS) return { claimed: false };

    if (existing) {
      await ctx.db.patch(existing._id, { status: "processing", startedAt: now });
    } else {
      await ctx.db.insert("publicationDeliveries", {
        deliveryId: args.deliveryId,
        status: "processing",
        startedAt: now,
      });
    }
    return { claimed: true };
  },
});

export const completeDelivery = mutation({
  args: { secret: v.string(), deliveryId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    requireDeliveryId(args.deliveryId);
    const existing = await ctx.db
      .query("publicationDeliveries")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
      .first();
    if (!existing) return { completed: false };
    await ctx.db.patch(existing._id, { status: "complete", completedAt: Date.now() });
    return { completed: true };
  },
});
