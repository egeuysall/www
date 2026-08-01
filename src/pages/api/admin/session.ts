import type { APIRoute } from "astro";

import { api } from "../../../../convex/_generated/api";
import { isAdmin, passwordMatches, setAdminSession } from "@/lib/admin-auth";
import { getActor, getConvexServerClient, getWriteSecret, json, rejectCrossOrigin } from "@/lib/engagement";

export const prerender = false;

export const GET: APIRoute = ({ cookies }) => json({ authenticated: isAdmin(cookies) });

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 4_096) return json({ error: "Request body too large" }, 413);

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string") return json({ error: "Invalid password" }, 401);
  try {
    await getConvexServerClient().mutation(api.interactions.checkAdminLogin, {
      secret: getWriteSecret(),
      rateHash: getActor(request, cookies).rateHash,
    });
  } catch {
    return json({ error: "Too many login attempts" }, 429);
  }
  if (!passwordMatches(body.password)) {
    return json({ error: "Invalid password" }, 401);
  }
  setAdminSession(cookies, request);
  return json({ authenticated: true });
};
