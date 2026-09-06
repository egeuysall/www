import { createElement } from "react";
import { render, toPlainText } from "react-email";

import { api } from "../../convex/_generated/api";
import NewsletterEmail, { type NewsletterEmailProps } from "../../emails/newsletter";
import { getConvexServerClient, getWriteSecret } from "@/lib/engagement";
import { createUnsubscribeToken } from "@/lib/newsletter";
import { formatDate } from "@/lib/utils";

const X_LIMIT = 280;
const LINKEDIN_LIMIT = 3_000;
const EMAIL_BATCH_SIZE = 100;

export type PublishedPost = {
  slug: string;
  content: string;
  title: string;
  description: string;
  publishedAt: string;
};

export type DistributionResult = {
  channel: "x" | "linkedin" | "email" | "substack";
  status: "published" | "handed_off" | "skipped" | "failed";
  detail?: string;
};

export function publicationInfoFromMarkdown(content: string, slug: string): PublishedPost | null {
  const title = frontmatterValue(content, "title");
  const description = frontmatterValue(content, "description");
  const publishedAt = frontmatterValue(content, "publishedAt");
  if (!title || !description || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return null;
  return { slug, content, title, description, publishedAt };
}

export function socialCopy(post: PublishedPost, url: string, limit: number): string {
  return truncate(`${post.title}\n\n${post.description}\n\n${url}`, limit);
}

// ponytail: direct fan-out keeps publishing immediate; add a durable delivery queue when retries/analytics are needed.
export async function publishToChannels(post: PublishedPost): Promise<DistributionResult[]> {
  try {
    const url = new URL(`/blog/${post.slug}/`, process.env.PUBLIC_SITE_URL || "https://egeuysal.com").toString();
    return await Promise.all([
      publishToX(post, url),
      publishToLinkedIn(post, url),
      publishNewsletter(post, url),
      handoffToSubstack(post, url),
    ]);
  } catch {
    return (["x", "linkedin", "email", "substack"] as const).map((channel) => ({
      channel,
      status: "failed" as const,
      detail: "Publication fan-out failed",
    }));
  }
}

async function publishToX(post: PublishedPost, url: string): Promise<DistributionResult> {
  const token = env("X_ACCESS_TOKEN");
  if (!token) return { channel: "x", status: "skipped", detail: "X_ACCESS_TOKEN is not configured" };
  try {
    const response = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: socialCopy(post, url, X_LIMIT) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { channel: "x", status: "failed", detail: `X returned ${response.status}` };
    return { channel: "x", status: "published" };
  } catch {
    return { channel: "x", status: "failed", detail: "X request failed" };
  }
}

async function publishToLinkedIn(post: PublishedPost, url: string): Promise<DistributionResult> {
  const token = env("LINKEDIN_ACCESS_TOKEN");
  const author = env("LINKEDIN_AUTHOR_URN");
  const version = env("LINKEDIN_API_VERSION");
  if (!token || !author || !version) {
    return { channel: "linkedin", status: "skipped", detail: "LinkedIn publishing is not configured" };
  }
  try {
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        commentary: truncate(`${post.title}\n\n${post.description}`, LINKEDIN_LIMIT),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          article: {
            source: url,
            title: post.title,
            description: post.description,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { channel: "linkedin", status: "failed", detail: `LinkedIn returned ${response.status}` };
    return { channel: "linkedin", status: "published" };
  } catch {
    return { channel: "linkedin", status: "failed", detail: "LinkedIn request failed" };
  }
}

async function publishNewsletter(post: PublishedPost, url: string): Promise<DistributionResult> {
  const token = env("RESEND_API_KEY");
  const from = env("NEWSLETTER_FROM");
  if (!token || !from) return { channel: "email", status: "skipped", detail: "Newsletter is not configured" };

  try {
    const client = getConvexServerClient();
    const subscribers = await client.query(api.newsletter.listSubscribed, { secret: getWriteSecret() });
    if (!subscribers.length) return { channel: "email", status: "skipped", detail: "No confirmed subscribers" };

    for (let index = 0; index < subscribers.length; index += EMAIL_BATCH_SIZE) {
      const batch = await Promise.all(subscribers.slice(index, index + EMAIL_BATCH_SIZE).map(async (email) => {
        const html = await render(createElement<Partial<NewsletterEmailProps>>(NewsletterEmail, {
          title: post.title,
          description: post.description,
          excerpt: newsletterExcerpt(post.content),
          publishedAt: formatDate(new Date(`${post.publishedAt}T00:00:00.000Z`)),
          url,
          unsubscribeUrl: newsletterUnsubscribeUrl(email).toString(),
        }));
        return {
          from,
          to: [email],
          subject: post.title,
          html,
          text: toPlainText(html),
        };
      }));
      const response = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { channel: "email", status: "failed", detail: `Email provider returned ${response.status}` };
    }
    return { channel: "email", status: "published", detail: `${subscribers.length} subscriber(s)` };
  } catch {
    return { channel: "email", status: "failed", detail: "Newsletter request failed" };
  }
}

async function handoffToSubstack(post: PublishedPost, url: string): Promise<DistributionResult> {
  const endpoint = env("SUBSTACK_AUTOMATION_WEBHOOK_URL");
  if (!endpoint) return { channel: "substack", status: "skipped", detail: "Substack handoff is not configured" };
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    return { channel: "substack", status: "failed", detail: "Substack handoff URL must use HTTPS" };
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = env("SUBSTACK_AUTOMATION_WEBHOOK_TOKEN");
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(parsed, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "blog.published",
        post: { ...post, url },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { channel: "substack", status: "failed", detail: `Substack handoff returned ${response.status}` };
    return { channel: "substack", status: "handed_off" };
  } catch {
    return { channel: "substack", status: "failed", detail: "Substack handoff failed" };
  }
}

function newsletterUnsubscribeUrl(email: string): URL {
  return new URL(`/newsletter?unsubscribe=${encodeURIComponent(createUnsubscribeToken(email))}`, siteUrl());
}

function newsletterExcerpt(content: string): string[] {
  const body = content.replace(/^---[\s\S]*?---\s*/, "");
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[*_`~]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  const excerpt: string[] = [];
  let remaining = 900;
  for (const paragraph of paragraphs) {
    if (excerpt.length === 2 || remaining <= 0) break;
    if (paragraph.length > remaining) break;
    excerpt.push(paragraph);
    remaining -= paragraph.length;
  }
  return excerpt;
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  const raw = match?.[1]?.trim() || "";
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }
  return raw.replace(/^'|'$/g, "");
}

function truncate(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length <= limit ? value : `${characters.slice(0, limit - 1).join("")}…`;
}

function siteUrl(): URL {
  return new URL(process.env.PUBLIC_SITE_URL || "https://egeuysal.com");
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}
