import { handle } from "@astrojs/cloudflare/handler";

// cdn.egeuysal.com and /cdn/* proxy assets that live in ibx (see src/pages/cdn-asset). Replaces the host rules from vercel.json.
const CDN_HOST = "cdn.egeuysal.com";
const CDN_ASSET_PREFIXES = ["/content/", "/photo/", "/photo-1080/"];

function routeCdn(request: Request): Request | Response | null {
  const url = new URL(request.url);

  if (url.hostname === CDN_HOST) {
    if (CDN_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      url.pathname = `/cdn-asset${url.pathname}`;
      url.hostname = "egeuysal.com";
      return new Request(url, request);
    }
    const target = url.pathname === "/" ? "https://egeuysal.com" : `https://egeuysal.com${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  }

  if (url.pathname.startsWith("/cdn/")) {
    url.pathname = `/cdn-asset/${url.pathname.slice("/cdn/".length)}`;
    return new Request(url, request);
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const routed = routeCdn(request);
    if (routed instanceof Response) return routed;
    return handle(routed ?? request, env, ctx);
  },

  // Daily knowledge index sync (was a Vercel cron hitting /api/knowledge-index).
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const secret = (env as unknown as Record<string, string>).CRON_SECRET;
    const request = new Request("https://egeuysal.com/api/knowledge-index", {
      headers: { authorization: `Bearer ${secret}` },
    });
    const response = await handle(request, env, ctx);
    if (!response.ok) console.error("knowledge-index cron failed", response.status);
  },
} satisfies ExportedHandler<Env>;
