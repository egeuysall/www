const TERMINAL_ORIGIN = "https://cyber-minds.github.io";
const MAX_URL_LENGTH = 2_048;
const MAX_REQUEST_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 128 * 1_024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

type TerminalCurlEnv = {
  TERMINAL_CURL_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
};

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin === TERMINAL_ORIGIN) return origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }
  return null;
}

function responseHeaders(origin: string | null, upstream?: Headers): Headers {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Expose-Headers",
      "content-type, date, etag, last-modified, server, x-powered-by",
    );
  }
  for (const name of [
    "content-type",
    "date",
    "etag",
    "last-modified",
    "server",
    "x-powered-by",
  ]) {
    const value = upstream?.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function publicWebUrl(value: string): URL | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const ipLiteral = host.startsWith("[") || /^\d+(?:\.\d+){0,3}$/.test(host);
    const localHost = [
      "localhost",
      ".localhost",
      ".local",
      ".internal",
      ".home.arpa",
      ".test",
      ".invalid",
      ".example",
    ].some((suffix) => host === suffix || host.endsWith(suffix));
    const proxyLoop =
      ["egeuysal.com", "www.egeuysal.com", "cdn.egeuysal.com"].includes(host) &&
      url.pathname === "/api/terminal-curl";
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      ipLiteral ||
      localHost ||
      proxyLoop ||
      !host.includes(".")
    )
      return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function boundedText(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_RESPONSE_BYTES - bytes;
      if (remaining === 0) {
        truncated = true;
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        break;
      }
      const size = Math.min(value.byteLength, remaining);
      chunks.push(decoder.decode(value.subarray(0, size), { stream: true }));
      bytes += size;
      if (size < value.byteLength) {
        truncated = true;
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
      }
      if (truncated) break;
    }
  } finally {
    reader.releaseLock();
  }
  chunks.push(decoder.decode());
  if (truncated) chunks.push("\n[curl: output truncated at 128 KiB]\n");
  return { text: chunks.join(""), truncated };
}

async function readRequestText(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  return chunks.join("") + decoder.decode();
}

async function fetchPublicUrl(
  url: URL,
  method: "GET" | "HEAD",
  signal: AbortSignal,
): Promise<Response> {
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal,
      headers: { Accept: "*/*", "User-Agent": "CyberMinds-Terminal/1.0" },
    });
    const location = response.headers.get("Location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return response;
    }
    if (redirect === MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new Error("too many redirects");
    }
    const nextUrl = publicWebUrl(new URL(location, url).href);
    await response.body?.cancel();
    if (!nextUrl) {
      throw new Error("redirect target is not a public HTTP(S) URL");
    }
    url = nextUrl;
  }
  throw new Error("too many redirects");
}

export async function handleTerminalCurl(
  request: Request,
  env: TerminalCurlEnv,
): Promise<Response> {
  const origin = allowedOrigin(request);
  const headers = responseHeaders(origin);
  if (!origin)
    return new Response("Origin not allowed", { status: 403, headers });
  if (request.method === "OPTIONS") {
    if (request.headers.get("Access-Control-Request-Method") !== "POST") {
      return new Response(null, { status: 403, headers });
    }
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return new Response("Only POST is supported", {
      status: 405,
      headers,
    });
  }
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "text/plain"
  ) {
    return new Response("Content-Type must be text/plain", {
      status: 415,
      headers,
    });
  }
  const body = await readRequestText(request);
  if (body === null) {
    return new Response("Request body exceeds 4 KiB", { status: 413, headers });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Request body must contain a JSON URL", {
      status: 400,
      headers,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Response("Request body must contain a URL object", {
      status: 400,
      headers,
    });
  }
  const payload = parsed as { url?: unknown; method?: unknown };
  const url =
    typeof payload.url === "string" ? publicWebUrl(payload.url) : null;
  const requestedMethod = payload.method || "GET";
  if (!url) {
    return new Response(
      "URL must be a public HTTP(S) hostname on port 80 or 443",
      { status: 400, headers },
    );
  }
  if (requestedMethod !== "GET" && requestedMethod !== "HEAD") {
    return new Response("Only GET and HEAD are supported", {
      status: 400,
      headers,
    });
  }
  const method = requestedMethod;

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rate = await env.TERMINAL_CURL_LIMITER.limit({ key: clientIp });
  if (!rate.success) {
    return new Response(
      "Terminal curl rate limit exceeded; retry in one minute",
      {
        status: 429,
        headers,
      },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetchPublicUrl(url, method, controller.signal);
    const body = method === "HEAD" ? null : await boundedText(upstream);
    const responseHeadersWithUpstream = responseHeaders(
      origin,
      upstream.headers,
    );
    if (body?.truncated) {
      responseHeadersWithUpstream.set("X-Terminal-Output-Truncated", "true");
      responseHeadersWithUpstream.set(
        "Access-Control-Expose-Headers",
        "content-type, date, etag, last-modified, server, x-powered-by, x-terminal-output-truncated",
      );
    }
    const noBody =
      method === "HEAD" || [204, 205, 304].includes(upstream.status);
    return new Response(noBody ? null : body?.text || null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeadersWithUpstream,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Upstream request timed out"
        : error instanceof Error
          ? error.message
          : "Upstream request failed";
    return new Response(message, { status: 502, headers });
  } finally {
    clearTimeout(timeout);
  }
}
