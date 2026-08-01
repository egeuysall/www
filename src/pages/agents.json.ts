import { SITE } from "@/config/site";
import {
  getDiaryEntrySlug,
  getPublishedBlogPosts,
  getPublishedDiaryEntries,
} from "@/lib/content";
import { toIsoDate, toLocalIsoDate } from "@/lib/utils";

type GetContext = {
  site: URL | undefined;
};

type SignalItem = {
  signal: string;
  tags: string[];
};

type DiarySignalItem = {
  date: string;
  signal: string;
  tags: string[];
};

type PromptContext = {
  product: string;
  founderAge: number;
  category: string;
  idealTeamSize: string;
  stage: string;
  focus: string;
  distribution: string[];
  activeTeamsTarget: number;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type IbxTodo = {
  id: string;
  title: string;
  notes: string | null;
  status: "open" | "done";
  dueDate: string | null;
  priority: number;
  recurrence: string;
  source: string;
  createdAt: number;
};

type IbxContext = {
  enabled: boolean;
  source: string;
  fetchedAt: string;
  today: string;
  auth: {
    authType: "apiKey";
    permission: "read";
  };
  stats: {
    total: number;
    open: number;
    done: number;
    highPriorityOpen: number;
    dueToday: number;
    overdueOpen: number;
    gtmOpen: number;
  };
  recent: Array<{
    id: string;
    title: string | null;
    status: "open" | "done";
    dueDate: string | null;
    priority: number;
    recurrence: string;
    source: string;
    createdAt: string;
    isGtm: boolean;
  }>;
  todayTasks: Array<{
    id: string;
    title: string;
    status: "open" | "done";
    dueDate: string | null;
    priority: number;
    recurrence: string;
    source: string;
    createdAt: string;
    isGtm: boolean;
  }>;
};

const BLOG_LIMIT = 8;
const DIARY_LIMIT = 12;
const TAG_LIMIT = 12;
const DISTRIBUTION_LIMIT = 3;
const RECENT_ACTIVITY_WINDOW_DAYS = 14;
const DEFAULT_FOUNDER_AGE = 16;
const FOUNDER_BIRTHDATE =
  process.env.PUBLIC_FOUNDER_BIRTHDATE ?? "2009-11-24";
const IBX_BASE_URL = process.env.IBX_BASE_URL ?? "https://ibx.egeuysal.com";
const IBX_PUBLIC_URL = "https://ibx.egeuysal.com";
const IBX_API_URL = "https://ibx.egeuysal.com/api/todos";
const IBX_API_KEY = process.env.IBX_API_KEY || import.meta.env.IBX_API_KEY;
const IBX_RECENT_TODOS_LIMIT = 8;
const IBX_FETCH_TIMEOUT_MS = 3500;
const IBX_TEXT_MAX_LENGTH = 140;
const DEFAULT_DISTRIBUTION_CHANNELS = ["reddit", "x", "linkedin"] as const;
const CHANNEL_ALIASES: Record<string, readonly string[]> = {
  reddit: ["reddit"],
  x: ["x", "twitter"],
  linkedin: ["linkedin"],
  github: ["github"],
  slack: ["slack"],
  youtube: ["youtube"],
  email: ["email", "newsletter"],
};
const OPERATOR_PROFILE = {
  product: "Ryva",
  category: "B2B SaaS",
  idealTeamSize: process.env.PUBLIC_OPERATOR_TEAM_SIZE ?? "3-15",
  loops: {
    firstRun: "curiosity",
    secondRun: "habit",
    thirdRun: "dependency",
  },
  worldview: [
    "standups_exist_because_state_is_not_visible",
    "issue_tracking_reflects_broken_handoffs",
    "context_is_the_next_layer",
    "ryva_reveals_blind_spots_from_real_work",
  ],
  weaknesses: [
    "can_over_explain",
    "can_push_second_run_too_hard",
    "still_refining_indispensable_output",
  ],
  edge: "redefine_how_teams_see_their_own_work",
} as const;
const GTM_TODO_KEYWORDS =
  /\b(gtm|outreach|follow[- ]?up|lead|prospect|distribution|second[- ]?run|repo run|dm|linkedin|reddit|\bx\b|thread)\b/i;

function getTopTags(tagLists: string[][], limit: number): string[] {
  const counts = new Map<string, number>();

  for (const tags of tagLists) {
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function toTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9/+.-]+/g) ?? [];
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateKey(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, month, day };
}

function getDatePartsInTimeZone(input: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(input);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);

  return { year, month, day };
}

function toDateKeyInTimeZone(input: Date, timeZone: string): string {
  const { year, month, day } = getDatePartsInTimeZone(input, timeZone);

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getFounderAge(referenceDate: Date, timeZone: string): number {
  const birthDate = parseDateKey(FOUNDER_BIRTHDATE);

  if (!birthDate) {
    return DEFAULT_FOUNDER_AGE;
  }

  const reference = getDatePartsInTimeZone(referenceDate, timeZone);
  let age = reference.year - birthDate.year;
  const birthdayPassed =
    reference.month > birthDate.month ||
    (reference.month === birthDate.month && reference.day >= birthDate.day);

  if (!birthdayPassed) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function inferDistributionChannels(items: SignalItem[], limit: number): string[] {
  const aliasToChannel = new Map<string, string>();
  const channelCounts = new Map<string, number>();

  for (const [channel, aliases] of Object.entries(CHANNEL_ALIASES)) {
    for (const alias of aliases) {
      aliasToChannel.set(alias, channel);
    }
  }

  for (const item of items) {
    const text = `${item.signal} ${item.tags.join(" ")}`.toLowerCase();
    const tokens = new Set([
      ...toTokens(text),
      ...item.tags.map((tag) => tag.trim().toLowerCase()),
    ]);

    if (/r\/[a-z0-9_]+/.test(text)) {
      tokens.add("reddit");
    }

    for (const token of tokens) {
      const channel = aliasToChannel.get(token);

      if (!channel) {
        continue;
      }

      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    }
  }

  const ranked = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([channel]) => channel);

  for (const fallback of DEFAULT_DISTRIBUTION_CHANNELS) {
    if (!ranked.includes(fallback)) {
      ranked.push(fallback);
    }
  }

  return ranked.slice(0, limit);
}

function getRecentActivityCount(
  diaryItems: DiarySignalItem[],
  referenceDate: Date,
  windowDays: number,
): number {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = referenceDate.getTime() - windowMs;

  return diaryItems.filter((entry) => {
    const date = parseDate(entry.date);
    return date ? date.getTime() >= cutoff : false;
  }).length;
}

function inferStageAndFocus(recentActivityCount: number): {
  stage: string;
  focus: string;
} {
  if (recentActivityCount >= 10) {
    return {
      stage: "working_product_with_active_distribution",
      focus: "interest_to_repeated_usage_loops",
    };
  }

  if (recentActivityCount >= 5) {
    return {
      stage: "working_product_with_early_testing",
      focus: "interest_to_repeated_usage",
    };
  }

  return {
    stage: "working_product_with_signal_collection",
    focus: "signal_to_interest_validation",
  };
}

function inferActiveTeamsTarget(
  recentActivityCount: number,
  gtmOpenTodoCount: number,
): number {
  const base = recentActivityCount >= 10 ? 4 : recentActivityCount >= 5 ? 3 : 2;
  const todoAdjustment =
    gtmOpenTodoCount >= 14 ? 2 : gtmOpenTodoCount >= 7 ? 1 : 0;

  return Math.min(6, Math.max(2, base + todoAdjustment));
}

function normalizeText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function isGtmTodo(todo: { title: string; notes: string | null }): boolean {
  return GTM_TODO_KEYWORDS.test(`${todo.title} ${todo.notes ?? ""}`);
}

function toTodoDateKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // ibx CLI currently models dueDate as UTC epoch ms.
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    return toIsoDate(new Date(ms));
  }

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const parsed = parseDate(value);
    return parsed ? toIsoDate(parsed) : null;
  }

  return null;
}

function normalizeIbxTodo(raw: unknown): IbxTodo | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const todo = raw as Record<string, unknown>;
  const id = typeof todo.id === "string" ? todo.id : null;
  const title = typeof todo.title === "string" ? todo.title : null;
  const status = todo.status === "open" || todo.status === "done" ? todo.status : null;
  const createdAt =
    typeof todo.createdAt === "number" && Number.isFinite(todo.createdAt)
      ? todo.createdAt
      : null;

  if (!id || !title || !status || createdAt === null) {
    return null;
  }

  const notes = typeof todo.notes === "string" ? todo.notes : null;
  const dueDate = toTodoDateKey(todo.dueDate);
  const priority =
    typeof todo.priority === "number" && Number.isFinite(todo.priority)
      ? todo.priority
      : 2;
  const recurrence =
    typeof todo.recurrence === "string" ? todo.recurrence : "none";
  const source = typeof todo.source === "string" ? todo.source : "manual";

  return {
    id,
    title: normalizeText(title, IBX_TEXT_MAX_LENGTH),
    notes: notes ? normalizeText(notes, IBX_TEXT_MAX_LENGTH) : null,
    status,
    dueDate,
    priority,
    recurrence,
    source,
    createdAt,
  };
}

async function fetchIbxContext(
  referenceDate: Date,
  timeZone: string,
): Promise<IbxContext> {
  if (!IBX_API_KEY) {
    throw new Error("missing_ibx_api_key");
  }

  const today = toDateKeyInTimeZone(referenceDate, timeZone);
  let sessionEndpoint: URL;
  let endpoint: URL;

  try {
    sessionEndpoint = new URL("/api/session", IBX_BASE_URL);
    endpoint = new URL("/api/todos", IBX_BASE_URL);
  } catch {
    throw new Error("invalid_ibx_base_url");
  }

  endpoint.searchParams.set("today", today);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IBX_FETCH_TIMEOUT_MS);

  try {
    const sessionResponse = await fetch(sessionEndpoint.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${IBX_API_KEY}`,
      },
      signal: controller.signal,
    });

    if (!sessionResponse.ok) {
      throw new Error(`ibx_session_http_${sessionResponse.status}`);
    }

    const sessionPayload = (await sessionResponse.json()) as {
      authenticated?: boolean;
      authType?: string;
      permission?: string;
    };

    if (!sessionPayload.authenticated || sessionPayload.authType !== "apiKey") {
      throw new Error("ibx_session_invalid");
    }

    if (sessionPayload.permission !== "read") {
      throw new Error("ibx_key_not_read_only");
    }

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${IBX_API_KEY}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ibx_http_${response.status}`);
    }

    const payload = (await response.json()) as { todos?: unknown };
    const rawTodos = Array.isArray(payload.todos) ? payload.todos : [];
    const todos = rawTodos
      .map((todo) => normalizeIbxTodo(todo))
      .filter((todo): todo is IbxTodo => Boolean(todo))
      .sort((a, b) => b.createdAt - a.createdAt);

    const openTodos = todos.filter((todo) => todo.status === "open");
    const dueToday = openTodos.filter((todo) => todo.dueDate === today).length;
    const overdueOpen = openTodos.filter(
      (todo) => Boolean(todo.dueDate && todo.dueDate < today),
    ).length;
    const highPriorityOpen = openTodos.filter((todo) => todo.priority === 1).length;
    const gtmOpen = openTodos.filter((todo) => isGtmTodo(todo)).length;
    const toPublicTask = (todo: IbxTodo) => ({
      id: todo.id,
      title: todo.title,
      status: todo.status,
      dueDate: todo.dueDate,
      priority: todo.priority,
      recurrence: todo.recurrence,
      source: todo.source,
      createdAt: new Date(todo.createdAt).toISOString(),
      isGtm: isGtmTodo(todo),
    });

    return {
      enabled: true,
      source: IBX_PUBLIC_URL,
      fetchedAt: referenceDate.toISOString(),
      today,
      auth: {
        authType: "apiKey",
        permission: "read",
      },
      stats: {
        total: todos.length,
        open: openTodos.length,
        done: todos.length - openTodos.length,
        highPriorityOpen,
        dueToday,
        overdueOpen,
        gtmOpen,
      },
      recent: todos.slice(0, IBX_RECENT_TODOS_LIMIT).map(toPublicTask),
      todayTasks: todos
        .filter((todo) => todo.status === "open" && todo.dueDate === today)
        .slice(0, IBX_RECENT_TODOS_LIMIT)
        .map(toPublicTask),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("ibx_timeout");
    }

    throw error instanceof Error ? error : new Error("ibx_fetch_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(name: string, context: PromptContext): string {
  return [
    `You are the execution operator for ${name}, a ${context.founderAge}-year-old founder building ${context.product}.`,
    `${context.product} is early-stage ${context.category} for small dev teams (${context.idealTeamSize}) and reconstructs project state from GitHub + Slack.`,
    `${context.product} output must surface: decisions made, missing decisions, blockers, next actions.`,
    "Do not optimize for first-run wow. Optimize for second-run habit, then third-run dependency.",
    "Use /diary for short-term GTM + product deltas. Use /blog for stable worldview and positioning.",
    "",
    `Current stage: ${context.stage}.`,
    `Primary goal: ${context.focus}.`,
    `Primary channels: ${context.distribution.join(", ")} conversations around standups, lost context, Jira drift.`,
    "Offer rule: continuation over commitment. Push for real data/repo context early; avoid hard selling.",
    "",
    "Positioning constraints:",
    "- Standups are a symptom of invisible project state.",
    "- Issue tracking is an artifact of broken handoffs.",
    `- Context is the next software layer; ${context.product} reveals blind spots teams miss.`,
    `- Make people feel blind without ${context.product}, not impressed by ${context.product}.`,
    "",
    "Execution constraints:",
    `- Depth over breadth: prioritize ${context.activeTeamsTarget} active teams over shallow top-of-funnel volume.`,
    "- Keep outputs short, specific, and action-first.",
    "- No fluff, no long explanation, no generic summaries.",
    "",
    "Output contract for every message:",
    "1. Reference the latest run.",
    "2. State what changed vs what is unresolved.",
    "3. Tie one unresolved item to a clear risk or cost.",
    "4. Ask exactly one forced binary question.",
    "5. Set a concrete time anchor for the next run.",
    "",
    "Behavior cautions:",
    "- Do not over-explain.",
    "- Do not force second-run language unnaturally.",
    "- Focus on making outputs indispensable, not just interesting.",
  ].join("\n");
}

export async function GET({ site }: GetContext): Promise<Response> {
  const generatedAt = new Date();
  const [blogPosts, diaryEntries] = await Promise.all([
    getPublishedBlogPosts(),
    getPublishedDiaryEntries(),
  ]);
  let ibxContext: IbxContext;

  try {
    ibxContext = await fetchIbxContext(generatedAt, SITE.timezone);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ibx_fetch_failed";

    return new Response(
      JSON.stringify(
        {
          generatedAt: toLocalIsoDate(generatedAt),
          error: "ibx_required_fetch_failed",
          reason,
        },
        null,
        2,
      ),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const baseUrl = site ?? new URL(SITE.url);

  const blogItems = blogPosts.slice(0, BLOG_LIMIT).map((post) => ({
    id: post.id,
    url: new URL(`/blog/${post.id}/`, baseUrl).toString(),
    publishedAt: toIsoDate(post.data.publishedAt),
    title: post.data.title,
    signal: post.data.description,
    tags: post.data.tags,
  }));

  const diaryCount = diaryEntries.length;
  const diaryItems: DiarySignalItem[] = diaryEntries
    .slice(0, DIARY_LIMIT)
    .map((entry, index) => {
      const slug = getDiaryEntrySlug(entry);

      return {
        id: entry.id,
        url: new URL(`/diary/${slug}/`, baseUrl).toString(),
        date: toIsoDate(entry.data.date),
        day: diaryCount - index,
        signal: entry.data.summary,
        tags: entry.data.tags,
      };
    });

  const topTags = getTopTags(
    [...blogItems, ...diaryItems].map((item) => item.tags),
    TAG_LIMIT,
  );
  const founderAge = getFounderAge(generatedAt, SITE.timezone);
  const distribution = inferDistributionChannels(
    [
      ...blogItems,
      ...diaryItems,
      ...ibxContext.recent.map((todo) => ({
        signal: todo.title ?? "",
        tags: todo.isGtm ? ["gtm", "todo"] : ["todo"],
      })),
    ].map((item) => ({
      signal: item.signal,
      tags: item.tags,
    })),
    DISTRIBUTION_LIMIT,
  );
  const recentActivityCount = getRecentActivityCount(
    diaryItems,
    generatedAt,
    RECENT_ACTIVITY_WINDOW_DAYS,
  );
  const { stage, focus } = inferStageAndFocus(recentActivityCount);
  const activeTeamsTarget = inferActiveTeamsTarget(
    recentActivityCount,
    ibxContext.stats.gtmOpen,
  );
  const strategyPriority =
    activeTeamsTarget > 3 ? "depth_with_selective_scale" : "depth_over_scale";
  const operator = {
    product: OPERATOR_PROFILE.product,
    founderAge,
    category: OPERATOR_PROFILE.category,
    idealTeamSize: OPERATOR_PROFILE.idealTeamSize,
    stage,
    focus,
    distribution,
    loops: OPERATOR_PROFILE.loops,
    strategy: {
      priority: strategyPriority,
      activeTeamsTarget,
      conversionView: "behavioral_not_transactional",
    },
    worldview: OPERATOR_PROFILE.worldview,
    weaknesses: OPERATOR_PROFILE.weaknesses,
    edge: OPERATOR_PROFILE.edge,
  } as const;
  const promptContext: PromptContext = {
    product: operator.product,
    founderAge: operator.founderAge,
    category: operator.category,
    idealTeamSize: operator.idealTeamSize,
    stage: operator.stage,
    focus: operator.focus,
    distribution: operator.distribution,
    activeTeamsTarget: operator.strategy.activeTeamsTarget,
  };

  return new Response(
    JSON.stringify(
      {
        generatedAt: toLocalIsoDate(generatedAt),
        profile: {
          name: SITE.author.name,
          role: SITE.author.role,
          site: baseUrl.toString(),
          description: SITE.description,
          timezone: SITE.timezone,
        },
        operator,
        sources: {
          blog: new URL("/blog/", baseUrl).toString(),
          diary: new URL("/diary/", baseUrl).toString(),
          blogJson: new URL("/blog.json", baseUrl).toString(),
          diaryJson: new URL("/diary.json", baseUrl).toString(),
          ibx: IBX_PUBLIC_URL,
          ibxApi: IBX_API_URL,
        },
        context: {
          latest: {
            blogDate: blogItems[0]?.publishedAt ?? null,
            diaryDate: diaryItems[0]?.date ?? null,
          },
          recurringTags: topTags,
          blog: blogItems,
          diary: diaryItems,
          ibx: ibxContext,
        },
        prompt: buildPrompt(SITE.author.name, promptContext),
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=120, s-maxage=120",
      },
    },
  );
}
