import type { APIRoute } from "astro";

import { isAdmin } from "@/lib/admin-auth";
import { slugFromPost } from "@/lib/blog-editor";
import { json, rejectCrossOrigin } from "@/lib/engagement";

export const prerender = false;

const API_ROOT = "https://api.github.com/repos/egeuysall/www/contents/src/content/blog";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_CONTENT_BYTES = 200_000;

export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isAdmin(cookies)) return json({ error: "Unauthorized" }, 401);
  const slug = url.searchParams.get("slug");
  if (slug && !SLUG.test(slug)) return json({ error: "Invalid slug" }, 400);

  const located = slug ? await findPost(slug) : { response: await github(API_ROOT), path: API_ROOT };
  const response = located.response;
  if (!response.ok) return json({ error: response.status === 404 ? "Post not found" : "GitHub request failed" }, response.status);
  const payload: unknown = await response.json();
  if (!slug) {
    const posts = Array.isArray(payload)
      ? payload.flatMap((item) => isGithubFile(item) && /\.mdx?$/.test(item.name) ? [item.name.replace(/\.mdx?$/, "")] : []).sort()
      : [];
    return json({ posts });
  }
  if (!isGithubFile(payload) || typeof payload.sha !== "string" || typeof payload.content !== "string") {
    return json({ error: "Invalid GitHub response" }, 502);
  }
  return json({ slug, sha: payload.sha, content: Buffer.from(payload.content, "base64").toString("utf8") });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!isAdmin(cookies)) return json({ error: "Unauthorized" }, 401);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_BYTES + 8_192) {
    return json({ error: "Request body too large" }, 413);
  }

  const body = await request.json().catch(() => null) as { slug?: unknown; sourceSlug?: unknown; sha?: unknown; content?: unknown } | null;
  if (
    !body
    || typeof body.slug !== "string"
    || body.slug.length > 120
    || !SLUG.test(body.slug)
    || (body.sourceSlug !== undefined && (typeof body.sourceSlug !== "string" || body.sourceSlug.length > 120 || !SLUG.test(body.sourceSlug)))
    || (body.sha !== undefined && (typeof body.sha !== "string" || !SHA.test(body.sha)))
    || typeof body.content !== "string"
  ) {
    return json({ error: "Invalid post" }, 400);
  }
  if (Buffer.byteLength(body.content) > MAX_CONTENT_BYTES || !validFrontmatter(body.content)) {
    return json({ error: "Post must have valid title, description, and publishedAt frontmatter" }, 400);
  }
  if (body.sourceSlug && body.sourceSlug !== body.slug) {
    return json({ error: "Existing post slugs cannot be changed" }, 400);
  }
  if (Boolean(body.sourceSlug) !== Boolean(body.sha)) {
    return json({ error: "Existing posts require their loaded revision" }, 400);
  }
  if (!body.sourceSlug && slugFromPost(body.content) !== body.slug) {
    return json({ error: "Slug must match the post title" }, 400);
  }

  const target = await findPost(body.slug);
  if (!target.response.ok && target.response.status !== 404) return json({ error: "GitHub request failed" }, 502);
  if (!body.sourceSlug && target.response.ok) return json({ error: "Slug already exists" }, 409);
  if (body.sourceSlug && !target.response.ok) return json({ error: "Post not found" }, 404);

  const path = target.response.ok ? target.path : `${API_ROOT}/${body.slug}.mdx`;
  const saved = await github(path, {
    method: "PUT",
    body: JSON.stringify({
      message: `${body.sha ? "Update" : "Publish"} blog post: ${body.slug}`,
      content: Buffer.from(body.content).toString("base64"),
      branch: "master",
      ...(body.sha ? { sha: body.sha } : {}),
    }),
  });
  if (!saved.ok) {
    return json({ error: saved.status === 409 || saved.status === 422 ? "Post changed elsewhere; reload before saving" : "GitHub rejected the publish" }, saved.status === 409 || saved.status === 422 ? 409 : 502);
  }

  return json({ ok: true, url: `/blog/${body.slug}/` });
};

function github(url: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "egeuysall-www-editor",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
}

async function findPost(slug: string): Promise<{ response: Response; path: string }> {
  const mdxPath = `${API_ROOT}/${slug}.mdx`;
  const mdx = await github(mdxPath);
  if (mdx.status !== 404) return { response: mdx, path: mdxPath };
  const mdPath = `${API_ROOT}/${slug}.md`;
  return { response: await github(mdPath), path: mdPath };
}

function isGithubFile(value: unknown): value is { name: string; sha?: string; content?: string } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

function validFrontmatter(content: string): boolean {
  if (!content.startsWith("---\n")) return false;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return false;
  const frontmatter = content.slice(4, end);
  return /^title:\s*.+$/m.test(frontmatter) && /^description:\s*.+$/m.test(frontmatter) && /^publishedAt:\s*\d{4}-\d{2}-\d{2}/m.test(frontmatter);
}
