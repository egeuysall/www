import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ConvexProvider, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "@/lib/client/convex";
import type { ContentKind } from "@/lib/engagement-input";

interface Props {
  convexUrl: string;
  kind: ContentKind;
  slug: string;
}
type CommentData = FunctionReturnType<typeof api.interactions.listComments>[number];

export default function EngagementPanel(props: Props) {
  if (!props.convexUrl) return null;
  return (
    <ConvexProvider client={getConvexClient(props.convexUrl)}>
      <Panel {...props} />
    </ConvexProvider>
  );
}

function Panel({ kind, slug }: Props) {
  const stats = useQuery(api.interactions.getStatsBatch, { items: [{ kind, slug }] });
  const comments = useQuery(api.interactions.listComments, { kind, slug });
  const [liked, setLiked] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void postJson({ action: "view", kind, slug }).catch(() => undefined);
    void postJson<{ contentLiked: boolean; likedCommentIds: string[] }>({ action: "state", kind, slug })
      .then((state) => {
        setLiked(state.contentLiked);
        setLikedComments(new Set(state.likedCommentIds));
      })
      .catch(() => undefined);
  }, [kind, slug]);

  const current = stats?.[0] ?? { viewCount: 0, likeCount: 0, commentCount: 0 };

  async function toggleLike() {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ liked: boolean }>({ action: "likeContent", kind, slug });
      setLiked(result.liked);
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="not-prose mt-10 border-t border-neutral-900 pt-6" aria-label="Post engagement">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
        <span className="tabular-nums">{current.viewCount.toLocaleString()} views</span>
        <button
          type="button"
          aria-pressed={liked}
          disabled={busy}
          onClick={toggleLike}
          className="cursor-pointer text-neutral-400 hover:text-neutral-100 disabled:cursor-wait disabled:opacity-60"
        >
          {liked ? "Liked" : "Like"} · {current.likeCount.toLocaleString()}
        </button>
        <span className="tabular-nums">{current.commentCount.toLocaleString()} comments</span>
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
      <CommentForm kind={kind} slug={slug} />

      <div className="mt-8 space-y-5">
        {comments === undefined ? (
          <p className="text-xs text-neutral-500">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-neutral-500">No comments yet.</p>
        ) : comments.map((comment) => (
          <Comment key={comment._id} comment={comment} initiallyLiked={likedComments.has(comment._id)} />
        ))}
      </div>
    </section>
  );
}

function CommentForm({ kind, slug }: Pick<Props, "kind" | "slug">) {
  const inputId = useId();
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!image) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function chooseFile(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 4 * 1024 * 1024) {
      setMessage("Use a JPEG, PNG, WebP, or GIF up to 4 MB.");
      return;
    }
    setMessage("");
    setImage(file);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    const form = new FormData(formElement);
    form.set("kind", kind);
    form.set("slug", slug);
    if (image) form.set("image", image);
    try {
      const response = await fetch("/api/engagement", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not post comment");
      formElement.reset();
      setImage(null);
      setMessage("Comment posted.");
    } catch (cause) {
      setMessage(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <div className="hidden" aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="block text-xs text-neutral-400">
        Name
        <input
          name="authorName"
          required
          minLength={2}
          maxLength={40}
          autoComplete="name"
          className="mt-1 block w-full rounded-sm border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
      </label>
      <label className="block text-xs text-neutral-400">
        Comment
        <textarea
          name="body"
          maxLength={2000}
          rows={4}
          placeholder="Write a comment…"
          className="mt-1 block w-full resize-y rounded-sm border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
      </label>

      <label
        htmlFor={inputId}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        className="flex cursor-pointer items-center gap-3 rounded-sm border border-dashed border-neutral-800 p-3 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
      >
        {preview ? <img src={preview} alt="Comment attachment preview" className="h-14 w-14 rounded-sm object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-sm border border-neutral-800">+</span>}
        <span>{image ? `${image.name} · ${(image.size / 1024 / 1024).toFixed(1)} MB` : "Drop an image here or choose one"}</span>
        <input
          id={inputId}
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
      </label>

      <div className="flex items-center gap-3">
        <button disabled={busy} className="cursor-pointer rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 hover:border-neutral-400 disabled:cursor-wait disabled:opacity-60">
          {busy ? "Posting…" : "Post comment"}
        </button>
        {image && <button type="button" onClick={() => setImage(null)} className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-200">Remove image</button>}
        {message && <span role="status" className="text-xs text-neutral-400">{message}</span>}
      </div>
    </form>
  );
}

function Comment({ comment, initiallyLiked }: { comment: CommentData; initiallyLiked: boolean }) {
  const [liked, setLiked] = useState(initiallyLiked);

  useEffect(() => setLiked(initiallyLiked), [initiallyLiked]);
  const [reported, setReported] = useState(false);

  async function like() {
    const result = await postJson<{ liked: boolean }>({ action: "likeComment", commentId: comment._id });
    setLiked(result.liked);
  }

  async function report() {
    if (!window.confirm("Report this comment for abuse or spam?")) return;
    await postJson({ action: "report", commentId: comment._id, reason: "abuse_or_spam" });
    setReported(true);
  }

  return (
    <article className="border-b border-neutral-900 pb-5">
      <div className="flex items-baseline justify-between gap-4">
        <strong className="text-xs font-medium text-neutral-100">{comment.authorName}</strong>
        <time className="text-[11px] text-neutral-500" dateTime={new Date(comment.createdAt).toISOString()}>
          {new Date(comment.createdAt).toLocaleDateString()}
        </time>
      </div>
      {comment.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">{comment.body}</p>}
      {comment.imageUrl && <img src={comment.imageUrl} alt="Comment attachment" loading="lazy" className="mt-3 max-h-96 max-w-full rounded-sm border border-neutral-800 object-contain" />}
      <div className="mt-3 flex gap-4 text-[11px] text-neutral-500">
        <button type="button" aria-pressed={liked} onClick={() => void like()} className="cursor-pointer hover:text-neutral-100">{liked ? "Liked" : "Like"} · {comment.likeCount}</button>
        <button type="button" disabled={reported} onClick={() => void report()} className="cursor-pointer hover:text-neutral-100 disabled:cursor-default disabled:opacity-60">{reported ? "Reported" : "Report"}</button>
      </div>
    </article>
  );
}

async function postJson<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/engagement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
