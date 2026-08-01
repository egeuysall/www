import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ConvexProvider, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "@/lib/client/convex";
import { REPORT_REASONS, type ContentKind } from "@/lib/engagement-input";

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
  const [ownedComments, setOwnedComments] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void postJson({ action: "view", kind, slug }).catch(() => undefined);
    void postJson<{ contentLiked: boolean; likedCommentIds: string[]; ownedCommentIds: string[] }>({ action: "state", kind, slug })
      .then((state) => {
        setLiked(state.contentLiked);
        setLikedComments(new Set(state.likedCommentIds));
        setOwnedComments((current) => new Set([...current, ...state.ownedCommentIds]));
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
      <CommentForm
        kind={kind}
        slug={slug}
        onPosted={(commentId) => setOwnedComments((current) => new Set(current).add(commentId))}
      />

      <div className="mt-8 space-y-5">
        {comments === undefined ? (
          <p className="text-xs text-neutral-500">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-neutral-500">No comments yet.</p>
        ) : comments.map((comment) => (
          <Comment
            key={comment._id}
            comment={comment}
            initiallyLiked={likedComments.has(comment._id)}
            canDelete={ownedComments.has(comment._id)}
          />
        ))}
      </div>
    </section>
  );
}

function CommentForm({
  kind,
  slug,
  onPosted,
}: Pick<Props, "kind" | "slug"> & { onPosted: (commentId: string) => void }) {
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
      const result = await response.json() as { error?: string; commentId?: string };
      if (!response.ok) throw new Error(result.error || "Could not post comment");
      if (result.commentId) onPosted(result.commentId);
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
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-sm border border-neutral-900 p-3">
      <div className="hidden" aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="block max-w-56">
        <span className="sr-only">Name</span>
        <input
          name="authorName"
          required
          minLength={2}
          maxLength={40}
          autoComplete="name"
          placeholder="Name"
          className="block w-full border-0 border-b border-neutral-800 bg-transparent px-0 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-500"
        />
      </label>
      <label className="block">
        <span className="sr-only">Comment</span>
        <textarea
          name="body"
          maxLength={2000}
          rows={3}
          placeholder="Write a comment…"
          className="block w-full resize-y border-0 bg-transparent py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-900 pt-3">
        <label
          htmlFor={inputId}
          onDragOver={(event) => event.preventDefault()}
          onDrop={drop}
          className="flex cursor-pointer items-center gap-2 rounded-sm border border-dashed border-neutral-800 px-2 py-1.5 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
        >
          {preview && <img src={preview} alt="Comment attachment preview" className="h-6 w-6 rounded-sm object-cover" />}
          <span>{image ? image.name : "+ Image"}</span>
          <input
            id={inputId}
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>
        <button disabled={busy} className="cursor-pointer rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 hover:border-neutral-400 disabled:cursor-wait disabled:opacity-60">
          {busy ? "Posting…" : "Post comment"}
        </button>
        {image && <button type="button" onClick={() => setImage(null)} className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-200">Remove image</button>}
        {message && <span role="status" className="text-xs text-neutral-400">{message}</span>}
      </div>
    </form>
  );
}

function Comment({
  comment,
  initiallyLiked,
  canDelete,
}: {
  comment: CommentData;
  initiallyLiked: boolean;
  canDelete: boolean;
}) {
  const [liked, setLiked] = useState(initiallyLiked);

  useEffect(() => setLiked(initiallyLiked), [initiallyLiked]);
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function like() {
    const result = await postJson<{ liked: boolean }>({ action: "likeComment", commentId: comment._id });
    setLiked(result.liked);
  }

  async function report(reason: string) {
    setBusy(true);
    setError("");
    try {
      await postJson({ action: "report", commentId: comment._id, reason });
      setReported(true);
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete your comment?")) return;
    setBusy(true);
    setError("");
    try {
      await postJson({ action: "deleteComment", commentId: comment._id });
    } catch (cause) {
      setError(getError(cause));
      setBusy(false);
    }
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
      <div className="mt-3 flex items-start gap-4 text-[11px] text-neutral-500">
        <button type="button" aria-pressed={liked} disabled={busy} onClick={() => void like()} className="cursor-pointer hover:text-neutral-100 disabled:opacity-60">{liked ? "Liked" : "Like"} · {comment.likeCount}</button>
        {reported ? (
          <span>Reported</span>
        ) : (
          <details className="relative">
            <summary className="cursor-pointer list-none hover:text-neutral-100">Report</summary>
            <div className="absolute left-0 z-10 mt-1 min-w-32 rounded-sm border border-neutral-800 bg-black p-1 shadow-xl">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={busy}
                  onClick={() => void report(reason)}
                  className="block w-full cursor-pointer rounded-sm px-2 py-1.5 text-left hover:bg-neutral-900 hover:text-neutral-100 disabled:opacity-60"
                >
                  {reason}
                </button>
              ))}
            </div>
          </details>
        )}
        {canDelete && (
          <button type="button" disabled={busy} onClick={() => void remove()} className="cursor-pointer text-red-400/80 hover:text-red-300 disabled:opacity-60">
            Delete
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-red-400">{error}</p>}
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
