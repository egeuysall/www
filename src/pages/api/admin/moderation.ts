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
  if (Number(request.headers.get("content-length") || 0) > 8_192) {
    return json({ error: "Request body too large" }, 413);
  }
  const body = await request.json().catch(() => null) as { commentId?: unknown } | null;
  if (!body || typeof body.commentId !== "string") {
    return json({ error: "Invalid moderation action" }, 400);
  }
  return json(await getConvexServerClient().mutation(api.interactions.deleteReportedComment, {
    secret: getWriteSecret(),
    commentId: body.commentId as Id<"comments">,
  }));
};
