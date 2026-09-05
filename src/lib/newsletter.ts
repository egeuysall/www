import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function newsletterTokenSecret(): string {
  const secret = process.env.NEWSLETTER_TOKEN_SECRET || process.env.INTERACTION_ACTOR_SALT || "";
  if (!secret) throw new Error("NEWSLETTER_TOKEN_SECRET is not configured");
  return secret;
}

export function hashNewsletterValue(value: string): string {
  return createHmac("sha256", newsletterTokenSecret()).update(value).digest("hex");
}

export function createConfirmationToken(): string {
  return randomBytes(32).toString("hex");
}

export function createUnsubscribeToken(email: string): string {
  const encoded = Buffer.from(normalizeEmail(email)).toString("base64url");
  const signature = createHmac("sha256", newsletterTokenSecret()).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function readUnsubscribeToken(token: string): string | null {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied || !/^[a-f0-9]{64}$/.test(supplied)) return null;
  const expected = Buffer.from(createHmac("sha256", newsletterTokenSecret()).update(encoded).digest("hex"));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const email = normalizeEmail(Buffer.from(encoded, "base64url").toString("utf8"));
    return isEmail(email) ? email : null;
  } catch {
    return null;
  }
}
