import type { APIRoute } from "astro";
import type { Id } from "../../../../convex/_generated/dataModel";

import { api } from "../../../../convex/_generated/api";
import { isAdmin } from "@/lib/admin-auth";
import { getConvexServerClient, getWriteSecret, json, rejectCrossOrigin } from "@/lib/engagement";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAdmin(cookies)) return json({ error: "Unauthorized" }, 401);
  return json(await getConvexServerClient().query(api.interactions.listReports, { secret: getWriteSecret() }));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!isAdmin(cookies)) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null) as { commentId?: unknown; action?: unknown } | null;
  if (!body || typeof body.commentId !== "string" || !["hide", "delete", "block"].includes(String(body.action))) {
    return json({ error: "Invalid moderation action" }, 400);
  }
  const client = getConvexServerClient();
  const secret = getWriteSecret();
  if (body.action === "block") {
    return json(await client.mutation(api.interactions.blockCommentAuthor, { secret, commentId: body.commentId as Id<"comments"> }));
  }
  return json(await client.mutation(api.interactions.moderateComment, {
    secret,
    commentId: body.commentId as Id<"comments">,
    action: body.action as "hide" | "delete",
  }));
};
