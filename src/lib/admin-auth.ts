import { createHmac, timingSafeEqual } from "node:crypto";

import type { AstroCookies } from "astro";

const COOKIE = "www_admin";
const MAX_AGE_SECONDS = 12 * 60 * 60;

function digest(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function sessionSecret(): string {
  const value = process.env.ADMIN_SESSION_SECRET || import.meta.env.ADMIN_SESSION_SECRET;
  if (!value) throw new Error("ADMIN_SESSION_SECRET is not configured");
  return value;
}

export function isAdmin(cookies: AstroCookies): boolean {
  const value = cookies.get(COOKIE)?.value;
  if (!value) return false;
  const [timestamp, signature] = value.split(".");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Date.now() - Number(timestamp) > MAX_AGE_SECONDS * 1000) return false;
  const expected = digest(timestamp, sessionSecret());
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordMatches(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || import.meta.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD is not configured");
  return timingSafeEqual(digest(password, sessionSecret()), digest(expected, sessionSecret()));
}

export function setAdminSession(cookies: AstroCookies, request: Request): void {
  const timestamp = String(Date.now());
  cookies.set(COOKIE, `${timestamp}.${digest(timestamp, sessionSecret()).toString("hex")}`, {
    httpOnly: true,
    maxAge: MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
  });
}
