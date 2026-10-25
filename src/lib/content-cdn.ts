const CONTENT_CDN_BASE_URL = "https://cdn.egeuysal.com/content/";
const HAS_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function ibxPublicUrlToCdn(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "ibx.egeuysal.com" || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/[^/]+\/(content|photo|photo-1080)\/.+/);
    if (!match) return null;
    url.hostname = "cdn.egeuysal.com";
    url.pathname = url.pathname.replace(/^\/[^/]+\//, "/");
    return url.toString();
  } catch {
    return null;
  }
}

function stripLeadingContentPath(value: string): string {
  return value.replace(/^content\/+/, "");
}

export function resolveContentCdnShorthand(input: string): string {
  const value = input.trim();

  if (!value) {
    return "";
  }

  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    HAS_PROTOCOL.test(value)
  ) {
    if (HAS_PROTOCOL.test(value)) return ibxPublicUrlToCdn(value) ?? value;
    return value;
  }

  return new URL(stripLeadingContentPath(value), CONTENT_CDN_BASE_URL).toString();
}
