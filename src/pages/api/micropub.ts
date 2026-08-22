import { timingSafeEqual } from "node:crypto";

import type { APIRoute } from "astro";

import { SITE } from "@/config/site";
import { slugFromPost, validFrontmatter } from "@/lib/blog-editor";
import { json } from "@/lib/engagement";

export const prerender = false;

const REPO_API = "https://api.github.com/repos/egeuysall/www";
const CONTENT_ROOT = "src/content/blog";
const API_ROOT = `${REPO_API}/contents/${CONTENT_ROOT}`;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTENT_BYTES = 200_000;
const MAX_REQUEST_BYTES = MAX_CONTENT_BYTES + 16_384;

type Fields = Record<string, unknown>;
type BlogPost = { slug: string; content: string };
type BuildResult = { post: BlogPost } | { error: string };

export const GET: APIRoute = ({ url }) => {
  if (url.searchParams.get("q") !== "config") {
    return json({ error: "Use q=config to inspect this Micropub endpoint" }, 400);
  }

  return json({ "post-types": ["article"], "syndicate-to": [] });
};

export const POST: APIRoute = async ({ request }) => {
  const token = configuredToken();
  if (!token) return json({ error: "Micropub is not configured" }, 503);
  if (!authorized(request, token)) return unauthorized();

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "application/json") {
    return json({ error: "Use application/x-www-form-urlencoded or application/json" }, 415);
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_REQUEST_BYTES) return json({ error: "Request body too large" }, 413);

  let fields: Fields | null;
  try {
    const text = new TextDecoder().decode(rawBody);
    fields = contentType === "application/json"
      ? normalizeFields(JSON.parse(text))
      : formFields(text);
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!fields) return json({ error: "Invalid request body" }, 400);

  const built = buildPost(fields);
  if ("error" in built) return json({ error: built.error }, 400);
  if (Buffer.byteLength(built.post.content) > MAX_CONTENT_BYTES) {
    return json({ error: "Post body too large" }, 413);
  }

  try {
    const existing = await findExisting(built.post.slug);
    if (existing.ok) return json({ error: "Slug already exists" }, 409);
    if (existing.status !== 404) return json({ error: "GitHub request failed" }, 502);

    const saved = await github(`${API_ROOT}/${built.post.slug}.mdx`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Publish blog post: ${built.post.slug}`,
        content: Buffer.from(built.post.content).toString("base64"),
        branch: "master",
      }),
    });
    if (!saved.ok) {
      return json(
        { error: saved.status === 409 || saved.status === 422 ? "Slug already exists" : "GitHub rejected the publish" },
        saved.status === 409 || saved.status === 422 ? 409 : 502,
      );
    }

    const location = new URL(`/blog/${built.post.slug}/`, SITE.url).toString();
    const response = json({ url: location }, 201);
    response.headers.set("Location", location);
    return response;
  } catch (error) {
    console.error("Micropub publish failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Publishing service unavailable" }, 503);
  }
};

function configuredToken(): string {
  return (process.env.MICROPUB_TOKEN || import.meta.env.MICROPUB_TOKEN || "").trim();
}

function authorized(request: Request, expectedToken: string): boolean {
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function unauthorized(): Response {
  const response = json({ error: "Unauthorized" }, 401);
  response.headers.set("WWW-Authenticate", "Bearer");
  return response;
}

function formFields(text: string): Fields {
  const fields: Fields = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const previous = fields[key];
    fields[key] = previous === undefined
      ? value
      : Array.isArray(previous)
        ? [...previous, value]
        : [previous, value];
  }
  return fields;
}

function normalizeFields(value: unknown): Fields | null {
  const root = asObject(value);
  if (!root) return null;
  return asObject(root.properties) ?? root;
}

function buildPost(fields: Fields): BuildResult {
  const h = firstValue(fields.h);
  if (h && h !== "entry" && h !== "h-entry") return { error: "Only h=entry posts are supported" };

  const rawContent = firstValue(fields.content);
  if (!rawContent) return { error: "content is required" };
  const content = rawContent.replace(/\r\n?/g, "\n").trimEnd() + "\n";
  const requestedSlug = firstValue(fields["mp-slug"]);
  const draftRequested = firstValue(fields["post-status"]).toLowerCase() === "draft"
    || firstValue(fields.draft).toLowerCase() === "true"
    || fields.draft === true;

  if (draftRequested) return { error: "Draft publishing is disabled" };

  if (content.startsWith("---\n")) {
    if (/^draft:\s*(?:true|yes)\s*$/im.test(content)) {
      return { error: "Draft publishing is disabled" };
    }
    if (!validFrontmatter(content)) {
      return { error: "Frontmatter must include title, description, and publishedAt" };
    }
    const derivedSlug = slugFromPost(content);
    const slug = requestedSlug || derivedSlug;
    if (!SLUG.test(slug) || slug.length > 120) return { error: "Invalid slug" };
    if (requestedSlug && requestedSlug !== derivedSlug) return { error: "Slug must match the post title" };
    return { post: { slug, content } };
  }

  const title = cleanLine(firstValue(fields.name) || headingFromContent(content)).replace(/^#+\s*/, "");
  if (title.length < 3) return { error: "name or a Markdown heading is required" };

  const description = cleanLine(firstValue(fields.summary) || firstParagraph(content) || "Published from iA Writer.").slice(0, 500);
  const publishedAt = normalizeDate(firstValue(fields.publishedAt) || firstValue(fields.published)) || today();
  const updatedAtValue = firstValue(fields.updatedAt);
  const updatedAt = updatedAtValue ? normalizeDate(updatedAtValue) : "";
  if (!publishedAt || (updatedAtValue && !updatedAt)) return { error: "Dates must use YYYY-MM-DD" };

  const tags = [...new Set(valuesOf(fields.category).flatMap((value) => value.split(",")).map(cleanLine).filter(Boolean))];
  if (tags.length > 20 || tags.some((tag) => tag.length > 64)) return { error: "Use at most 20 tags of 64 characters or fewer" };

  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `publishedAt: ${publishedAt}`,
    ...(updatedAt ? [`updatedAt: ${updatedAt}`] : []),
    `tags: ${JSON.stringify(tags)}`,
    "draft: false",
    "---",
    "",
  ].join("\n");
  const generated = `${frontmatter}${content.trimStart()}`;
  const derivedSlug = slugFromPost(generated);
  const slug = requestedSlug || derivedSlug;
  if (!SLUG.test(slug) || slug.length > 120) return { error: "Invalid slug" };
  if (requestedSlug && requestedSlug !== derivedSlug) return { error: "Slug must match the post title" };

  return { post: { slug, content: generated } };
}

function headingFromContent(content: string): string {
  return content.match(/^\s*#{1,6}\s+(.+)$/m)?.[1] || "";
}

function firstParagraph(content: string): string {
  const block = content.split(/\n\s*\n/).find((value) => value.trim() && !value.trim().startsWith("#"));
  return (block || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]/g, " ");
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeDate(value: string): string {
  const candidate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
  if (!DATE.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(candidate) ? candidate : "";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return firstValue(value[0]);
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const object = asObject(value);
  if (object) return firstValue(object.value ?? object.html);
  return "";
}

function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valuesOf);
  const result = firstValue(value);
  return result ? [result] : [];
}

function asObject(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : null;
}

function github(url: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "egeuysall-www-micropub",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
}

async function findExisting(slug: string): Promise<Response> {
  const mdx = await github(`${API_ROOT}/${slug}.mdx`);
  if (mdx.status !== 404) return mdx;
  return github(`${API_ROOT}/${slug}.md`);
}
