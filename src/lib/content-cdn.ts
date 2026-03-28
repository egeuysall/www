const CONTENT_CDN_BASE_URL = "https://cdn.egeuysal.com/content/";
const HAS_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

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
    return value;
  }

  return new URL(stripLeadingContentPath(value), CONTENT_CDN_BASE_URL).toString();
}
