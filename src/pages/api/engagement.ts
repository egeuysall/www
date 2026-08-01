import type { APIRoute } from "astro";
import type { Id } from "../../../convex/_generated/dataModel";

import { api } from "../../../convex/_generated/api";
import {
  getActor,
  contentExists,
  getConvexServerClient,
  getWriteSecret,
  json,
  rejectCrossOrigin,
} from "@/lib/engagement";
import { isContentKind, isReportReason, isSlug } from "@/lib/engagement-input";

export const prerender = false;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

type JsonBody = Record<string, unknown>;

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 32_768) {
    return json({ error: "Request body too large" }, 413);
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    return contentType.startsWith("multipart/form-data")
      ? await createComment(request, getActor(request, cookies))
      : await handleJson(request, getActor(request, cookies));
  } catch (error) {
    console.error("Engagement request failed", error);
    const message = error instanceof Error ? error.message : "Request failed";
    const isLimited = /rate limit/i.test(message);
    return json({ error: isLimited ? message : "Request failed" }, isLimited ? 429 : 400);
  }
};

async function handleJson(request: Request, actor: ReturnType<typeof getActor>): Promise<Response> {
  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const client = getConvexServerClient();
  const secret = getWriteSecret();
  const action = body.action;

  if (action === "view" || action === "likeContent") {
    if (!isContentKind(body.kind) || !isSlug(body.slug)) {
      return json({ error: "Invalid content" }, 400);
    }
    if (!(await contentExists(body.kind, body.slug))) return json({ error: "Content not found" }, 404);
    const args = { secret, ...actor, kind: body.kind, slug: body.slug };
    const result = action === "view"
      ? await client.mutation(api.interactions.recordView, args)
      : await client.mutation(api.interactions.toggleContentLike, args);
    return json(result);
  }

  if (action === "state") {
    if (!isContentKind(body.kind) || !isSlug(body.slug) || !(await contentExists(body.kind, body.slug))) {
      return json({ error: "Invalid content" }, 400);
    }
    return json(await client.query(api.interactions.getViewerState, {
      secret,
      actorHash: actor.actorHash,
      kind: body.kind,
      slug: body.slug,
    }));
  }

  if (action === "likeComment") {
    if (typeof body.commentId !== "string") return json({ error: "Invalid comment" }, 400);
    return json(await client.mutation(api.interactions.toggleCommentLike, {
      secret,
      ...actor,
      commentId: body.commentId as Id<"comments">,
    }));
  }

  if (action === "report") {
    if (typeof body.commentId !== "string" || !isReportReason(body.reason)) {
      return json({ error: "Invalid report" }, 400);
    }
    return json(await client.mutation(api.interactions.reportComment, {
      secret,
      ...actor,
      commentId: body.commentId as Id<"comments">,
      reason: body.reason,
    }));
  }

  if (action === "deleteComment") {
    if (typeof body.commentId !== "string") return json({ error: "Invalid comment" }, 400);
    return json(await client.mutation(api.interactions.deleteOwnComment, {
      secret,
      actorHash: actor.actorHash,
      commentId: body.commentId as Id<"comments">,
    }));
  }

  return json({ error: "Unknown action" }, 400);
}

async function createComment(request: Request, actor: ReturnType<typeof getActor>): Promise<Response> {
  const form = await request.formData();
  const kind = form.get("kind");
  const slug = form.get("slug");
  const authorName = form.get("authorName");
  const body = form.get("body");
  const honeypot = form.get("website");
  const image = form.get("image");

  if (honeypot) return json({ ok: true });
  if (!isContentKind(kind) || !isSlug(slug) || typeof authorName !== "string" || typeof body !== "string") {
    return json({ error: "Invalid comment" }, 400);
  }
  if (!(await contentExists(kind, slug))) return json({ error: "Content not found" }, 404);

  const file = image instanceof File && image.size > 0 ? image : null;
  if (file && (file.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(file.type))) {
    return json({ error: "Use a JPEG, PNG, WebP, or GIF up to 4 MB" }, 400);
  }

  const client = getConvexServerClient();
  const secret = getWriteSecret();
  let storageId: string | undefined;

  try {
    if (file) {
      const uploadUrl = await client.mutation(api.interactions.generateUploadUrl, { secret, ...actor });
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Image upload failed");
      storageId = ((await upload.json()) as { storageId: string }).storageId;
    }

    return json(await client.mutation(api.interactions.createComment, {
      secret,
      ...actor,
      kind,
      slug,
      authorName,
      body,
      ...(storageId ? { storageId: storageId as Id<"_storage"> } : {}),
    }));
  } catch (error) {
    if (storageId) {
      await client.mutation(api.interactions.deleteUpload, {
        secret,
        ...actor,
        storageId: storageId as Id<"_storage">,
      }).catch(() => undefined);
    }
    throw error;
  }
}
