import type { APIRoute } from "astro";

import { isAdmin } from "@/lib/admin-auth";
import { slugFromPost, validFrontmatter } from "@/lib/blog-editor";
import { json, rejectCrossOrigin } from "@/lib/engagement";
import { publicationInfoFromMarkdown, publishToChannels } from "@/lib/publishing";

export const prerender = false;

const REPO_API = "https://api.github.com/repos/egeuysall/www";
const CONTENT_ROOT = "src/content/blog";
const API_ROOT = `${REPO_API}/contents/${CONTENT_ROOT}`;
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
  if (Boolean(body.sourceSlug) !== Boolean(body.sha)) {
    return json({ error: "Existing posts require their loaded revision" }, 400);
  }
  if (slugFromPost(body.content) !== body.slug) {
    return json({ error: "Slug must match the post title" }, 400);
  }

  const source = body.sourceSlug ? await findPost(body.sourceSlug) : null;
  if (source && !source.response.ok) return json({ error: source.response.status === 404 ? "Post not found" : "GitHub request failed" }, source.response.status === 404 ? 404 : 502);
  const sourcePayload = source ? await source.response.json() as unknown : null;
  if (sourcePayload && (!isGithubFile(sourcePayload) || sourcePayload.sha !== body.sha)) {
    return json({ error: "Post changed elsewhere; reload before saving" }, 409);
  }

  const target = await findPost(body.slug);
  if (!target.response.ok && target.response.status !== 404) return json({ error: "GitHub request failed" }, 502);
  if (!body.sourceSlug && target.response.ok) return json({ error: "Slug already exists" }, 409);
  if (body.sourceSlug && body.sourceSlug !== body.slug && target.response.ok) return json({ error: "Slug already exists" }, 409);

  if (body.sourceSlug && body.sourceSlug !== body.slug) {
    const renamed = await commitPostRename(source!.repoPath, `${CONTENT_ROOT}/${body.slug}${source!.repoPath.endsWith(".md") ? ".md" : ".mdx"}`, body.sha!, body.content, body.slug);
    if (!renamed.ok) return json({ error: renamed.status === 409 ? "Post changed elsewhere; reload before saving" : "GitHub rejected the publish" }, renamed.status === 409 ? 409 : 502);
    return json({ ok: true, url: `/blog/${body.slug}/` });
  }

  const path = source?.path ?? `${API_ROOT}/${body.slug}.mdx`;
  const saved = await github(path, {
    method: "PUT",
    body: JSON.stringify({
      message: `${body.sha ? "Update" : "Publish via private editor"} blog post: ${body.slug}`,
      content: Buffer.from(body.content).toString("base64"),
      branch: "master",
      ...(body.sha ? { sha: body.sha } : {}),
    }),
  });
  if (!saved.ok) {
    return json({ error: saved.status === 409 || saved.status === 422 ? "Post changed elsewhere; reload before saving" : "GitHub rejected the publish" }, saved.status === 409 || saved.status === 422 ? 409 : 502);
  }

  const url = `/blog/${body.slug}/`;
  const post = publicationInfoFromMarkdown(body.content, body.slug);
  const distribution = !body.sha && post ? await publishToChannels(post) : [];
  return json({ ok: true, url, distribution });
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

async function findPost(slug: string): Promise<{ response: Response; path: string; repoPath: string }> {
  const mdxRepoPath = `${CONTENT_ROOT}/${slug}.mdx`;
  const mdxPath = `${API_ROOT}/${slug}.mdx`;
  const mdx = await github(mdxPath);
  if (mdx.status !== 404) return { response: mdx, path: mdxPath, repoPath: mdxRepoPath };
  const mdRepoPath = `${CONTENT_ROOT}/${slug}.md`;
  const mdPath = `${API_ROOT}/${slug}.md`;
  return { response: await github(mdPath), path: mdPath, repoPath: mdRepoPath };
}

async function commitPostRename(oldPath: string, newPath: string, oldSha: string, content: string, slug: string): Promise<Response> {
  const ref = await github(`${REPO_API}/git/ref/heads/master`);
  if (!ref.ok) return ref;
  const head = await ref.json() as { object?: { sha?: string } };
  const headSha = head.object?.sha;
  if (!headSha) return new Response(null, { status: 502 });
  const base = await github(`${REPO_API}/git/commits/${headSha}`);
  if (!base.ok) return base;
  const baseCommit = await base.json() as { tree?: { sha?: string } };
  const baseTreeSha = baseCommit.tree?.sha;
  if (!baseTreeSha) return new Response(null, { status: 502 });
  const baseTree = await github(`${REPO_API}/git/trees/${baseTreeSha}?recursive=1`);
  if (!baseTree.ok) return baseTree;
  const baseTreePayload = await baseTree.json() as { tree?: Array<{ path?: string; sha?: string }> };
  const entries = baseTreePayload.tree ?? [];
  if (entries.find((entry) => entry.path === oldPath)?.sha !== oldSha || entries.some((entry) => entry.path === newPath)) {
    return new Response(null, { status: 409 });
  }

  const tree = await github(`${REPO_API}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        { path: newPath, mode: "100644", type: "blob", content },
        { path: oldPath, mode: "100644", type: "blob", sha: null },
      ],
    }),
  });
  if (!tree.ok) return tree;
  const treePayload = await tree.json() as { sha?: string };
  if (!treePayload.sha) return new Response(null, { status: 502 });

  const commit = await github(`${REPO_API}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Update blog post: ${slug}`,
      tree: treePayload.sha,
      parents: [headSha],
    }),
  });
  if (!commit.ok) return commit;
  const commitPayload = await commit.json() as { sha?: string };
  if (!commitPayload.sha) return new Response(null, { status: 502 });

  return github(`${REPO_API}/git/refs/heads/master`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitPayload.sha, force: false }),
  });
}

function isGithubFile(value: unknown): value is { name: string; sha?: string; content?: string } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}
