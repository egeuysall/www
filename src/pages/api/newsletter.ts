import { createElement } from "react";
import { render, toPlainText } from "react-email";
import type { APIRoute } from "astro";

import { api } from "../../../convex/_generated/api";
import ConfirmationEmail, { type ConfirmationEmailProps } from "../../../emails/confirmation";
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

  const fields = await readFields(request);
  if (!fields) return json({ error: "Invalid request body" }, 400);

  const unsubscribeToken = typeof fields.unsubscribe === "string" ? fields.unsubscribe.trim() : "";
  if (unsubscribeToken) {
    const email = readUnsubscribeToken(unsubscribeToken);
    if (!email) return respond(request, { error: "That link is invalid or expired." }, 400, "error");
    try {
      const client = getConvexServerClient();
      await client.mutation(api.newsletter.unsubscribe, {
        secret: getWriteSecret(),
        emailHash: hashNewsletterValue(`email:${email}`),
      });
      return respond(request, { ok: true, message: "You’re unsubscribed." }, 200, "unsubscribed");
    } catch (error) {
      console.error("Newsletter unsubscribe failed", error instanceof Error ? error.message : "Unknown error");
      return respond(request, { error: "Newsletter unsubscribe failed" }, 503, "error");
    }
  }

  const rawEmail = typeof fields.email === "string" ? fields.email : "";
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) return json({ error: "Enter a valid email address" }, 400);
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
    if (result.status === "subscribed") {
      return respond(request, { ok: true, message: "You’re already subscribed." }, 200, "already-subscribed");
    }
    return respond(request, { ok: true, message: "Check your email to confirm your subscription." }, 200, "check");
  } catch (error) {
    console.error("Newsletter subscription failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Newsletter subscription failed" }, 503);
  }
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const confirmationToken = url.searchParams.get("confirm");
    if (confirmationToken) {
      const client = getConvexServerClient();
      const result = await client.mutation(api.newsletter.confirm, {
        secret: getWriteSecret(),
        confirmTokenHash: hashNewsletterValue(`confirm:${confirmationToken}`),
      });
      return redirect(url, result.confirmed ? "confirmed" : "error");
    }

    const unsubscribeToken = url.searchParams.get("unsubscribe");
    if (unsubscribeToken) {
      if (!readUnsubscribeToken(unsubscribeToken)) return redirect(url, "error");
      return new Response(null, {
        status: 303,
        headers: { Location: new URL(`/newsletter/?unsubscribe=${encodeURIComponent(unsubscribeToken)}`, url).toString() },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { Location: new URL("/newsletter/", url).toString() },
    });
  } catch {
    return redirect(url, "error");
  }
};

async function readFields(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "application/json") return null;
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = contentType === "application/json"
      ? JSON.parse(new TextDecoder().decode(raw))
      : Object.fromEntries(new URLSearchParams(new TextDecoder().decode(raw)));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
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
    body: JSON.stringify(await confirmationEmailPayload(confirmationUrl, email)),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

async function confirmationEmailPayload(confirmationUrl: string, email: string) {
  const html = await render(createElement<Partial<ConfirmationEmailProps>>(ConfirmationEmail, { confirmationUrl }));
  return {
    from: process.env.NEWSLETTER_FROM,
    to: [email],
    subject: "Confirm your subscription",
    html,
    text: toPlainText(html),
  };
}

function redirect(url: URL, status: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(`/newsletter?status=${status}`, url).toString() },
  });
}

function respond(request: Request, body: Record<string, unknown>, status: number, redirectStatus: string): Response {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json"
    ? json(body, status)
    : redirect(new URL(request.url), redirectStatus);
}

function siteUrl(): URL {
  return new URL(process.env.PUBLIC_SITE_URL || "https://egeuysal.com");
}
