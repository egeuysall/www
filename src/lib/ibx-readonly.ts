import { toIsoDate } from "@/lib/utils";

const IBX_BASE_URL = "https://ibx.egeuysal.com";
const IBX_PUBLIC_URL = "https://ibx.egeuysal.com";
const IBX_API_KEY = "iak_0HSYBPd0-mvdbkrxHaR5XLixBJt33ol8";
const IBX_FETCH_TIMEOUT_MS = 3500;
const IBX_TEXT_MAX_LENGTH = 140;
export const IBX_TODOS_PAGE_SIZE = 9;
const GTM_TODO_KEYWORDS =
  /\b(gtm|outreach|follow[- ]?up|lead|prospect|distribution|second[- ]?run|repo run|dm|linkedin|reddit|\bx\b|thread)\b/i;

type IbxRawTodo = Record<string, unknown>;

type IbxTodoStatus = "open" | "done";

export type IbxTodo = {
  id: string;
  title: string;
  notes: string | null;
  status: IbxTodoStatus;
  dueDate: string | null;
  priority: number;
  recurrence: string;
  source: string;
  createdAt: string;
  isGtm: boolean;
};

export type IbxReadonlySnapshot = {
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
  todos: IbxTodo[];
};

export type IbxReadonlyPageState = {
  snapshot: IbxReadonlySnapshot | null;
  error: string | null;
};

function normalizePriority(value: number): 1 | 2 | 3 {
  if (!Number.isFinite(value)) {
    return 2;
  }

  const rounded = Math.round(value);
  const clamped = Math.min(3, Math.max(1, rounded));
  return clamped as 1 | 2 | 3;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function toDateKeyInTimeZone(input: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(input);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toTodoDateKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
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

function toCreatedAtIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

function isGtmTodo(todo: { title: string; notes: string | null }): boolean {
  return GTM_TODO_KEYWORDS.test(`${todo.title} ${todo.notes ?? ""}`);
}

function normalizeIbxTodo(raw: unknown): IbxTodo | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const todo = raw as IbxRawTodo;
  const id = typeof todo.id === "string" ? todo.id : null;
  const title = typeof todo.title === "string" ? todo.title : null;
  const status = todo.status === "open" || todo.status === "done" ? todo.status : null;
  const createdAt = toCreatedAtIso(todo.createdAt);

  if (!id || !title || !status || !createdAt) {
    return null;
  }

  const notes = typeof todo.notes === "string" ? todo.notes : null;
  const normalizedTodo = {
    id,
    title: normalizeText(title, IBX_TEXT_MAX_LENGTH),
    notes: notes ? normalizeText(notes, IBX_TEXT_MAX_LENGTH) : null,
  };

  return {
    id: normalizedTodo.id,
    title: normalizedTodo.title,
    notes: normalizedTodo.notes,
    status,
    dueDate: toTodoDateKey(todo.dueDate),
    priority:
      typeof todo.priority === "number" && Number.isFinite(todo.priority)
        ? todo.priority
        : 2,
    recurrence:
      typeof todo.recurrence === "string" ? todo.recurrence : "none",
    source: typeof todo.source === "string" ? todo.source : "manual",
    createdAt,
    isGtm: isGtmTodo(normalizedTodo),
  };
}

export async function fetchIbxReadonlySnapshot(
  referenceDate: Date,
  timeZone: string,
): Promise<IbxReadonlySnapshot> {
  const today = toDateKeyInTimeZone(referenceDate, timeZone);
  const sessionEndpoint = new URL("/api/session", IBX_BASE_URL);
  const todosEndpoint = new URL("/api/todos", IBX_BASE_URL);
  todosEndpoint.searchParams.set("today", today);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IBX_FETCH_TIMEOUT_MS);

  try {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${IBX_API_KEY}`,
    };

    const sessionResponse = await fetch(sessionEndpoint.toString(), {
      method: "GET",
      headers,
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

    const todosResponse = await fetch(todosEndpoint.toString(), {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!todosResponse.ok) {
      throw new Error(`ibx_http_${todosResponse.status}`);
    }

    const payload = (await todosResponse.json()) as { todos?: unknown };
    const rawTodos = Array.isArray(payload.todos) ? payload.todos : [];
    const todos = rawTodos
      .map((todo) => normalizeIbxTodo(todo))
      .filter((todo): todo is IbxTodo => Boolean(todo))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const openTodos = todos.filter((todo) => todo.status === "open");

    return {
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
        highPriorityOpen: openTodos.filter((todo) => todo.priority === 1).length,
        dueToday: openTodos.filter((todo) => todo.dueDate === today).length,
        overdueOpen: openTodos.filter(
          (todo) => Boolean(todo.dueDate && todo.dueDate < today),
        ).length,
        gtmOpen: openTodos.filter((todo) => todo.isGtm).length,
      },
      todos,
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

export async function loadIbxReadonlyPageState(
  timeZone: string,
): Promise<IbxReadonlyPageState> {
  try {
    const snapshot = await fetchIbxReadonlySnapshot(new Date(), timeZone);
    return { snapshot, error: null };
  } catch (error) {
    return {
      snapshot: null,
      error: error instanceof Error ? error.message : "ibx_fetch_failed",
    };
  }
}

export function getTodayIbxTodos(snapshot: IbxReadonlySnapshot): IbxTodo[] {
  return snapshot.todos
    .filter((todo) => todo.dueDate === snapshot.today)
    .sort((a, b) => {
      const byPriority = normalizePriority(a.priority) - normalizePriority(b.priority);

      if (byPriority !== 0) {
        return byPriority;
      }

      return b.createdAt.localeCompare(a.createdAt);
    });
}
