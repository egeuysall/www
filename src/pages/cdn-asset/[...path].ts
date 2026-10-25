import type { APIRoute } from "astro";

export const prerender = false;

const IBX_PUBLIC_BASE = "https://ibx.egeuysal.com/egeuysall/";
const R2_PUBLIC_BASE = "https://pub-9fdddd84473b494eaa064f2306a09969.r2.dev/";
const ALLOWED_PREFIXES = new Set(["content", "photo", "photo-1080"]);
const FORWARDED_HEADERS = ["accept-ranges", "content-length", "content-range", "content-security-policy", "content-type", "etag", "last-modified"];

function assetPath(path: string | undefined): string | null {
  const parts = (path ?? "").split("/");
  if (
    parts.length < 2 ||
    !ALLOWED_PREFIXES.has(parts[0]) ||
    parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || /[\u0000-\u001f]/.test(part))
  ) return null;
  return parts.map(encodeURIComponent).join("/");
}

async function fetchAsset(url: string, request: Request): Promise<Response> {
  const headers = new Headers();
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return fetch(url, { method: request.method, headers, redirect: "error" });
}

function proxyResponse(upstream: Response, path: string): Response {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", upstream.ok ? "public, max-age=31536000, immutable" : "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  if (path.toLowerCase().endsWith(".svg")) {
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

const proxy: APIRoute = async ({ params, request }) => {
  const path = assetPath(params.path);
  if (!path) return new Response("Not found", { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetchAsset(new URL(path, IBX_PUBLIC_BASE).toString(), request);
    if (upstream.ok) return proxyResponse(upstream, path);
  } catch {
    // Fall back to R2 while an asset is being migrated or if IBX is unavailable.
  }

  try {
    upstream = await fetchAsset(new URL(path, R2_PUBLIC_BASE).toString(), request);
    return proxyResponse(upstream, path);
  } catch {
    return new Response("File not found", { status: 404 });
  }
};

export const GET = proxy;
export const HEAD = proxy;
