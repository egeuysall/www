import { useEffect, useState, type FormEvent } from "react";

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
    setSlug(nextSlug);
    if (!nextSlug) {
      setContent(newPost());
      return;
    }
    setBusy(true);
    try {
      const post = await request<{ content: string }>(`/api/admin/blog?slug=${encodeURIComponent(nextSlug)}`);
      setContent(post.content);
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
        body: JSON.stringify({ slug, content }),
      });
      setStatus(`Committed to master. Vercel is deploying ${result.url}`);
      await loadDashboard();
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function moderate(commentId: string, action: "hide" | "delete" | "block") {
    if (!window.confirm(`${action} this comment${action === "block" ? " and block its author" : ""}?`)) return;
    await request("/api/admin/moderation", {
      method: "POST",
      body: JSON.stringify({ commentId, action }),
    });
    await loadDashboard();
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
          <label className="min-w-48 flex-1 text-xs text-neutral-400">Post
            <select value={posts.includes(slug) ? slug : ""} onChange={(event) => void loadPost(event.target.value)} className="mt-1 block w-full rounded-sm border border-neutral-800 bg-bg px-3 py-2 text-sm text-neutral-100">
              <option value="">New post</option>
              {posts.map((post) => <option key={post} value={post}>{post}</option>)}
            </select>
          </label>
          <label className="min-w-48 flex-1 text-xs text-neutral-400">Slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="my-post" className="mt-1 block w-full rounded-sm border border-neutral-800 bg-transparent px-3 py-2 text-sm text-neutral-100" />
          </label>
        </div>
        <label className="block text-xs text-neutral-400">MDX
          <textarea value={content} onChange={(event) => setContent(event.target.value)} required rows={28} spellCheck className="mt-1 block w-full resize-y rounded-sm border border-neutral-800 bg-transparent p-3 font-mono text-xs leading-relaxed text-neutral-100 outline-none focus:border-neutral-500" />
        </label>
        <div className="flex items-center gap-3">
          <button disabled={busy} className="rounded-sm border border-neutral-700 px-3 py-2 text-xs text-neutral-100 disabled:opacity-60">{busy ? "Saving…" : "Commit and deploy"}</button>
          {status && <span role="status" className="text-xs text-neutral-400">{status}</span>}
        </div>
      </form>

      <section>
        <h2 className="text-sm text-neutral-100">Reported comments</h2>
        <div className="mt-4 space-y-4">
          {reports.length === 0 ? <p className="text-xs text-neutral-500">No open reports.</p> : reports.map((report) => report.comment && (
            <article key={report.reportId} className="rounded-sm border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">{report.comment.kind}/{report.comment.slug} · {report.reason}</p>
              <p className="mt-2 text-sm text-neutral-300"><strong>{report.comment.authorName || "Anonymous"}:</strong> {report.comment.body}</p>
              {report.comment.imageUrl && <img src={report.comment.imageUrl} alt="Reported comment attachment" className="mt-3 max-h-48 rounded-sm object-contain" />}
              <div className="mt-3 flex gap-3 text-xs">
                <button type="button" onClick={() => void moderate(report.comment!._id, "hide")} className="text-neutral-400 hover:text-neutral-100">Hide</button>
                <button type="button" onClick={() => void moderate(report.comment!._id, "delete")} className="text-neutral-400 hover:text-neutral-100">Delete</button>
                <button type="button" onClick={() => void moderate(report.comment!._id, "block")} className="text-red-400 hover:text-red-300">Block author</button>
              </div>
            </article>
          ))}
        </div>
      </section>
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
