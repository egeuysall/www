import { useEffect, useState, type FormEvent } from "react";
import { Combobox } from "@base-ui/react/combobox";

import { setPostTitle, slugFromPost, titleFromPost } from "@/lib/blog-editor";

type Report = {
  reportId: string;
  reason: string;
  comment: null | {
    _id: string;
    kind: string;
    slug: string;
    authorName: string | null;
    body: string | null;
    imageUrl: string | null;
  };
};

export default function BlogEditor() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<string[]>([]);
  const [selectedPost, setSelectedPost] = useState("");
  const [loadedSha, setLoadedSha] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState(newPost());
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void request<{ authenticated: boolean }>("/api/admin/session")
      .then(({ authenticated }) => {
        setAuthenticated(authenticated);
        if (authenticated) void loadDashboard();
      })
      .catch(() => setAuthenticated(false));
  }, []);

  async function loadDashboard() {
    const [postData, reportData] = await Promise.all([
      request<{ posts: string[] }>("/api/admin/blog"),
      request<Report[]>("/api/admin/moderation"),
    ]);
    setPosts(postData.posts);
    setReports(reportData);
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const password = new FormData(event.currentTarget).get("password");
    try {
      await request("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) });
      setAuthenticated(true);
      await loadDashboard();
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPost(nextSlug: string) {
    if (!nextSlug) {
      const draft = newPost();
      setSelectedPost("");
      setLoadedSha("");
      setContent(draft);
      setTitle(titleFromPost(draft));
      setSlug(slugFromPost(draft));
      return;
    }
    setBusy(true);
    try {
      const post = await request<{ content: string; sha: string }>(`/api/admin/blog?slug=${encodeURIComponent(nextSlug)}`);
      setSelectedPost(nextSlug);
      setLoadedSha(post.sha);
      setContent(post.content);
      setTitle(titleFromPost(post.content));
      setSlug(nextSlug);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await request<{ url: string }>("/api/admin/blog", {
        method: "POST",
        body: JSON.stringify({ slug, sourceSlug: selectedPost || undefined, sha: loadedSha || undefined, content }),
      });
      setStatus(`Committed to master. Vercel is deploying ${result.url}`);
      await loadDashboard();
      await loadPost(slug);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReportedComment(commentId: string) {
    if (!window.confirm("Delete this comment and its attachment?")) return;
    setBusy(true);
    setStatus("");
    try {
      await request("/api/admin/moderation", {
        method: "POST",
        body: JSON.stringify({ commentId }),
      });
      await loadDashboard();
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }

  function updateContent(nextContent: string) {
    setContent(nextContent);
    setTitle(titleFromPost(nextContent));
    if (!selectedPost) setSlug(slugFromPost(nextContent));
  }

  if (authenticated === null) return <p className="text-xs text-neutral-400">Loading…</p>;
  if (!authenticated) {
    return (
      <form onSubmit={login} className="max-w-sm space-y-3">
        <label className="block text-xs text-neutral-400">Admin password
          <input name="password" type="password" required autoComplete="current-password" className="mt-1 block w-full rounded-sm border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500" />
        </label>
        <button disabled={busy} className="rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 disabled:opacity-60">Sign in</button>
        {status && <p role="alert" className="text-xs text-red-400">{status}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-10">
      <form onSubmit={save} className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-48 flex-1 text-xs text-neutral-400">
            <label htmlFor="post-combobox">Post</label>
            <Combobox.Root
              items={posts}
              value={selectedPost || null}
              onValueChange={(value) => {
                if (value !== undefined) void loadPost(value || "");
              }}
              autoHighlight
            >
              <Combobox.Input
                id="post-combobox"
                placeholder="Search posts…"
                className="mt-1 block w-full rounded-sm border border-neutral-800 bg-bg px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-500"
              />
              <Combobox.Portal>
                <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
                  <Combobox.Popup className="max-h-[min(var(--available-height),20rem)] w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto rounded-sm border border-neutral-800 bg-black p-1 text-sm text-neutral-200 shadow-xl outline-none">
                    <Combobox.Empty className="px-2 py-2 text-xs text-neutral-500">No posts found.</Combobox.Empty>
                    <Combobox.List>
                      {(post: string) => (
                        <Combobox.Item
                          key={post}
                          value={post}
                          className="cursor-default rounded-sm px-2 py-1.5 outline-none data-highlighted:bg-neutral-900 data-highlighted:text-neutral-100"
                        >
                          {post}
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </Combobox.Popup>
                </Combobox.Positioner>
              </Combobox.Portal>
            </Combobox.Root>
            <button type="button" onClick={() => void loadPost("")} disabled={busy} className="mt-2 rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 disabled:opacity-60">
              New post
            </button>
          </div>
          <label className="min-w-48 flex-1 text-xs text-neutral-400">Slug
            <input value={slug} readOnly required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="Generated from title" className="mt-1 block w-full rounded-sm border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-400" />
          </label>
        </div>
        <label className="block text-xs text-neutral-400">Title
          <input
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              const nextContent = setPostTitle(content, nextTitle);
              setContent(nextContent);
              if (!selectedPost) setSlug(slugFromPost(nextContent));
            }}
            required
            placeholder="Post title"
            className="mt-1 block w-full rounded-sm border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>
        <label className="block text-xs text-neutral-400">MDX
          <textarea value={content} onChange={(event) => updateContent(event.target.value)} required rows={28} spellCheck className="mt-1 block w-full resize-y rounded-sm border border-neutral-800 bg-transparent p-3 font-mono text-xs leading-relaxed text-neutral-100 outline-none focus:border-neutral-500" />
        </label>
        <div className="flex items-center gap-3">
          <button disabled={busy} className="rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 disabled:opacity-60">{busy ? "Saving…" : "Commit and deploy"}</button>
          {status && <span role="status" className="text-xs text-neutral-400">{status}</span>}
        </div>
      </form>

      {reports.length > 0 && <section>
        <h2 className="text-sm text-neutral-100">Reported comments</h2>
        <div className="mt-4 space-y-4">
          {reports.map((report) => report.comment && (
            <article key={report.reportId} className="rounded-sm border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">{report.comment.kind}/{report.comment.slug} · {report.reason}</p>
              <p className="mt-2 text-sm text-neutral-300"><strong>{report.comment.authorName || "Anonymous"}:</strong> {report.comment.body}</p>
              {report.comment.imageUrl && <img src={report.comment.imageUrl} alt="Reported comment attachment" className="mt-3 max-h-48 rounded-sm object-contain" />}
              <button type="button" disabled={busy} onClick={() => void deleteReportedComment(report.comment!._id)} className="mt-3 text-xs text-red-400 hover:text-red-300 disabled:opacity-60">Delete comment and attachment</button>
            </article>
          ))}
        </div>
      </section>}
    </div>
  );
}

async function request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function newPost(): string {
  return `---\ntitle: ""\ndescription: ""\npublishedAt: ${new Date().toISOString().slice(0, 10)}\ntags: []\ndraft: true\n---\n\nWrite here.\n`;
}
