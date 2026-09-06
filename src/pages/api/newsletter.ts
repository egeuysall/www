import type { APIRoute } from "astro";

import { api } from "../../../convex/_generated/api";
import { getActor, getConvexServerClient, getWriteSecret, json, rejectCrossOrigin } from "@/lib/engagement";
import {
  createConfirmationToken,
  hashNewsletterValue,
  isEmail,
  normalizeEmail,
  readUnsubscribeToken,
} from "@/lib/newsletter";

export const prerender = false;

const MAX_BODY_BYTES = 2_048;

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }

  const email = await readEmail(request);
  if (!email) return json({ error: "Enter a valid email address" }, 400);
  if (!process.env.RESEND_API_KEY || !process.env.NEWSLETTER_FROM) {
    return json({ error: "Newsletter is not configured" }, 503);
  }

  try {
    const confirmationToken = createConfirmationToken();
    const client = getConvexServerClient();
    const result = await client.mutation(api.newsletter.subscribe, {
      secret: getWriteSecret(),
      email,
      emailHash: hashNewsletterValue(`email:${email}`),
      confirmTokenHash: hashNewsletterValue(`confirm:${confirmationToken}`),
      rateHash: getActor(request, cookies).rateHash,
    });

    if (result.status === "pending") {
      const sent = await sendConfirmationEmail(email, confirmationToken);
      if (!sent) return json({ error: "Could not send confirmation email" }, 502);
    }
    const body = { ok: true, message: "Check your email to confirm your subscription." };
    return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json"
      ? json(body)
      : Response.redirect(new URL("/newsletter?status=check", request.url), 303);
  } catch (error) {
    console.error("Newsletter subscription failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Newsletter subscription failed" }, 503);
  }
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const client = getConvexServerClient();
    const secret = getWriteSecret();
    const confirmationToken = url.searchParams.get("confirm");
    if (confirmationToken) {
      const result = await client.mutation(api.newsletter.confirm, {
        secret,
        confirmTokenHash: hashNewsletterValue(`confirm:${confirmationToken}`),
      });
      return redirect(url, result.confirmed ? "confirmed" : "error");
    }

    const unsubscribeToken = url.searchParams.get("unsubscribe");
    if (unsubscribeToken) {
      const email = readUnsubscribeToken(unsubscribeToken);
      if (!email) return redirect(url, "error");
      await client.mutation(api.newsletter.unsubscribe, {
        secret,
        emailHash: hashNewsletterValue(`email:${email}`),
      });
      return redirect(url, "unsubscribed");
    }
    return Response.redirect(new URL("/newsletter/", url), 303);
  } catch {
    return redirect(url, "error");
  }
};

async function readEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "application/json") return null;
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return null;
  try {
    const value = contentType === "application/json"
      ? (JSON.parse(new TextDecoder().decode(raw)) as { email?: unknown }).email
      : new URLSearchParams(new TextDecoder().decode(raw)).get("email");
    if (typeof value !== "string") return null;
    const email = normalizeEmail(value);
    return isEmail(email) ? email : null;
  } catch {
    return null;
  }
}

async function sendConfirmationEmail(email: string, token: string): Promise<boolean> {
  const confirmationUrl = new URL(`/api/newsletter?confirm=${encodeURIComponent(token)}`, siteUrl()).toString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.NEWSLETTER_FROM,
      to: [email],
      subject: "Confirm your subscription",
      html: `<p>Click to confirm your subscription to Ege Uysal's blog.</p><p><a href="${escapeHtml(confirmationUrl)}">Confirm subscription</a></p>`,
      text: `Confirm your subscription: ${confirmationUrl}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

function redirect(url: URL, status: string): Response {
  return Response.redirect(new URL(`/newsletter?status=${status}`, url), 303);
}

function siteUrl(): URL {
  return new URL(process.env.PUBLIC_SITE_URL || "https://egeuysal.com");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
