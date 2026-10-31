import type { APIRoute } from "astro";
import { timingSafeEqual } from "node:crypto";

import { syncKnowledgeBase } from "@/lib/knowledge-base";

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = process.env.CRON_SECRET || import.meta.env.CRON_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(cronSecret ? `Bearer ${cronSecret}` : "");
  if (!cronSecret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await syncKnowledgeBase();
    return json(result);
  } catch (error) {
    console.error("AI knowledge index sync failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Knowledge index sync failed" }, 503);
  }
};
