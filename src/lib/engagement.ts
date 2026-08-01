import { createHmac, randomUUID } from "node:crypto";

import type { AstroCookies } from "astro";
import { ConvexHttpClient } from "convex/browser";
import { getCollection } from "astro:content";
import type { ContentKind } from "@/lib/engagement-input";

const VISITOR_COOKIE = "www_visitor";

export type EngagementActor = { actorHash: string; rateHash: string };

export function getConvexServerClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL || import.meta.env.CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export function getWriteSecret(): string {
  const secret = process.env.INTERACTION_WRITE_SECRET || import.meta.env.INTERACTION_WRITE_SECRET;
  if (!secret) throw new Error("INTERACTION_WRITE_SECRET is not configured");
  return secret;
}

export function getActor(request: Request, cookies: AstroCookies): EngagementActor {
  const salt = process.env.INTERACTION_ACTOR_SALT || import.meta.env.INTERACTION_ACTOR_SALT;
  if (!salt) throw new Error("INTERACTION_ACTOR_SALT is not configured");

  let visitor = cookies.get(VISITOR_COOKIE)?.value;
  if (!visitor) {
    visitor = randomUUID();
    cookies.set(VISITOR_COOKIE, visitor, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
    });
  }

  const ip =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local";
  return {
    actorHash: createHmac("sha256", salt).update(`visitor:${visitor}`).digest("hex"),
    rateHash: createHmac("sha256", salt).update(`ip:${ip}`).digest("hex"),
  };
}

export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    // Fall through to the same generic rejection.
  }
  return json({ error: "Cross-origin requests are not allowed" }, 403);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function contentExists(kind: ContentKind, slug: string): Promise<boolean> {
  const entries = await getCollection(kind, ({ data }) => !data.draft);
  return entries.some((entry) => entry.id === slug);
}
