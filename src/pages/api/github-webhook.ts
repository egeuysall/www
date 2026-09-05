import { createHmac, timingSafeEqual } from "node:crypto";

import type { APIRoute } from "astro";

import { api } from "../../../convex/_generated/api";
import { getConvexServerClient, getWriteSecret, json } from "@/lib/engagement";
import { publicationInfoFromMarkdown, publishToChannels, type PublishedPost } from "@/lib/publishing";

export const prerender = false;

const REPO_API = "https://api.github.com/repos/egeuysall/www";
const CONTENT_ROOT = "src/content/blog";
const BRANCH_REF = "refs/heads/master";
const MAX_BODY_BYTES = 1_000_000;
const SHA_RE = /^[a-f0-9]{40}$/;
const BLOG_PATH_RE = /^src\/content\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\.mdx?$/;

type Commit = { message?: unknown; added?: unknown };
type PushPayload = {
  ref?: unknown;
  after?: unknown;
  repository?: { full_name?: unknown };
  commits?: unknown;
};

export const POST: APIRoute = async ({ request }) => {
  const secret = env("GITHUB_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Webhook is not configured" }, 503);

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return json({ error: "Request body too large" }, 413);
  if (!validSignature(request.headers.get("x-hub-signature-256"), raw, secret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  const event = request.headers.get("x-github-event");
  if (event === "ping") return json({ ok: true });
  if (event !== "push") return json({ ignored: true }, 202);

  let payload: PushPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as PushPayload;
  } catch {
    return json({ error: "Invalid payload" }, 400);
  }

  if (payload.repository?.full_name !== "egeuysall/www" || payload.ref !== BRANCH_REF) {
    return json({ ignored: true }, 202);
  }
  const deliveryId = request.headers.get("x-github-delivery")?.trim() || "";
  const after = typeof payload.after === "string" ? payload.after : "";
  if (!deliveryId || !SHA_RE.test(after)) return json({ error: "Invalid delivery" }, 400);

  const paths = newCommits(payload.commits)
    .flatMap((commit) => {
      const message = typeof commit.message === "string" ? commit.message : "";
      if (!message.startsWith("Publish blog post: ")) return [];
      return Array.isArray(commit.added) ? commit.added : [];
    })
    .filter((path): path is string => typeof path === "string" && BLOG_PATH_RE.test(path));
  const uniquePaths = [...new Set(paths)];
  if (!uniquePaths.length) return json({ ok: true, published: 0 }, 202);

  const client = getConvexServerClient();
  const claimed = await client.mutation(api.publication.claimDelivery, {
    secret: getWriteSecret(),
    deliveryId,
  });
  if (!claimed.claimed) return json({ ok: true, duplicate: true }, 202);

  try {
    const posts = (await Promise.all(uniquePaths.map((path) => readPost(path, after)))).filter(
      (post): post is PublishedPost => post !== null,
    );
    const distribution = await Promise.all(posts.map((post) => publishToChannels(post)));
    await client.mutation(api.publication.completeDelivery, {
      secret: getWriteSecret(),
      deliveryId,
    });
    return json({ ok: true, published: posts.length, distribution }, 202);
  } catch (error) {
    console.error("GitHub publication webhook failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Publication webhook failed" }, 502);
  }
};

function validSignature(value: string | null, raw: ArrayBuffer, secret: string): boolean {
  const supplied = value?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
  if (!supplied) return false;
  const expected = createHmac("sha256", secret).update(new Uint8Array(raw)).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function newCommits(value: unknown): Commit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((commit): commit is Commit => typeof commit === "object" && commit !== null);
}

async function readPost(path: string, ref: string): Promise<PublishedPost | null> {
  const token = env("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${REPO_API}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "egeuysall-www-publisher",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const payload = await response.json() as { type?: unknown; content?: unknown };
  if (payload.type !== "file" || typeof payload.content !== "string") throw new Error("Invalid GitHub content response");
  const content = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  const slug = path.slice(CONTENT_ROOT.length + 1).replace(/\.mdx?$/, "");
  return publicationInfoFromMarkdown(content, slug);
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}
