import { z } from "zod";

export const AI_PAGE_MAX_QUESTION_LENGTH = 800;
export const AI_PAGE_MAX_CONTEXT_LENGTH = 24_000;
export const AI_PAGE_RATE_LIMIT = 8;
export const AI_PAGE_RATE_WINDOW_MS = 60_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type ParsedAiPageRequest = {
  question: string;
  page: {
    path: string;
    title: string;
    description: string;
    content: string;
  };
};

const aiPageRequestSchema = z.object({
  question: z.string().min(1).max(AI_PAGE_MAX_QUESTION_LENGTH),
  page: z.object({
    path: z.string().min(1).max(256),
    title: z.string().min(1).max(160),
    description: z.string().max(500).optional().default(""),
    content: z.string().min(1).max(AI_PAGE_MAX_CONTEXT_LENGTH),
  }),
});

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function normalizePath(path: string): string | null {
  const trimmed = path.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  if (trimmed.includes("\0") || /[\r\n]/.test(trimmed)) {
    return null;
  }

  return trimmed.replace(/\/{2,}/g, "/").slice(0, 256);
}

function compactWhitespace(value: string, maxLength: number): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, maxLength);
}

export function parseAiPageRequest(value: unknown): ParsedAiPageRequest | null {
  const parsed = aiPageRequestSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const path = normalizePath(parsed.data.page.path);
  const question = compactWhitespace(parsed.data.question, AI_PAGE_MAX_QUESTION_LENGTH);
  const title = compactWhitespace(parsed.data.page.title, 160);
  const description = compactWhitespace(parsed.data.page.description ?? "", 500);
  const content = compactWhitespace(parsed.data.page.content, AI_PAGE_MAX_CONTEXT_LENGTH);

  if (!path || !question || !title || !content) {
    return null;
  }

  return {
    question,
    page: {
      path,
      title,
      description,
      content,
    },
  };
}

export function getAiOverlayClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const candidate = forwardedFor || realIp || "unknown";

  if (candidate.length > 96 || !/^[A-Za-z0-9:._-]+$/.test(candidate)) {
    return "unknown";
  }

  return candidate;
}

export function checkAiOverlayRateLimit(
  key: string,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + AI_PAGE_RATE_WINDOW_MS,
    });
    cleanupExpiredRateLimitBuckets(now);
    return { allowed: true };
  }

  if (existing.count >= AI_PAGE_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true };
}

export function buildAiPagePrompt(input: ParsedAiPageRequest): string {
  return [
    `Page: ${input.page.title}`,
    `Path: ${input.page.path}`,
    input.page.description ? `Description: ${input.page.description}` : "",
    "",
    "Visible page content:",
    "```text",
    input.page.content,
    "```",
    "",
    `Question: ${input.question}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function cleanupExpiredRateLimitBuckets(now: number): void {
  if (rateLimitBuckets.size < 512) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}
