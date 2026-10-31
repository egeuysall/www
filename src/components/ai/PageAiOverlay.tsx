import { useEffect, useRef, useState } from "react";
import { math } from "@streamdown/math";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { codeToHtml } from "shiki";
import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  AI_GUIDE_CHAT_STORAGE_KEY,
  AI_GUIDE_OPEN_STORAGE_KEY,
  AI_GUIDE_WIDTH_STORAGE_KEY,
} from "@/lib/ai-preferences";
import {
  SHIKI_DARK_THEME,
  SHIKI_LIGHT_THEME,
  SHIKI_STREAMDOWN_THEMES,
} from "@/lib/code-themes.mjs";
import { Spinner } from "@/components/ui/spinner";

type OverlayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type PageContext = {
  path: string;
  title: string;
  description: string;
  content: string;
};

const AI_STORAGE_VERSION = 3;
const MAX_QUESTION_LENGTH = 800;
const MAX_CONTEXT_LENGTH = 6_000;
const MIN_AI_GUIDE_WIDTH = 320;
const emojiPattern = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D]/gu;
const AI_CODE_COPY_ATTR = "data-ai-copyable-code-block";
const looseMathPattern = /\(([^()\n]*(?:\\[a-zA-Z]+|[_^{}=+*]|\s[/-]\s|[∫√π∞])[^()\n]*)\)/g;
const codeFencePattern = /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g;
const codeFenceStartPattern = /(^|\n)```([A-Za-z0-9_-]+)?[ \t]*\n/g;

type MarkdownPart =
  | { type: "markdown"; content: string }
  | { type: "code"; content: string; language: string };

type TableProps = TableHTMLAttributes<HTMLTableElement> & { node?: unknown };
type SectionProps = HTMLAttributes<HTMLTableSectionElement> & { node?: unknown };
type RowProps = HTMLAttributes<HTMLTableRowElement> & { node?: unknown };
type HeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & { node?: unknown };
type DataCellProps = TdHTMLAttributes<HTMLTableCellElement> & { node?: unknown };
type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value: string, maxLength: number): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, maxLength);
}

function normalizeLooseMath(content: string): string {
  const segments = content.split(codeFencePattern);

  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment;
      }

      return segment.replace(looseMathPattern, (_match, expression: string) => {
        return `$${expression.trim()}$`;
      });
    })
    .join("");
}

function inferCodeLanguage(content: string, explicitLanguage?: string): string {
  const normalizedLanguage = explicitLanguage?.toLowerCase();
  if (normalizedLanguage && normalizedLanguage !== "text") {
    return normalizedLanguage === "golang" ? "go" : normalizedLanguage;
  }

  if (/\bpackage\s+\w+|\bfunc\s+\w+\s*\(|\bgo\s+func\b|\bchan\s+\w+|:=|\bfmt\./.test(content)) {
    return "go";
  }

  if (/\b(console\.log|const|let|var|function|import|export|=>|await)\b/.test(content)) {
    return "javascript";
  }

  return explicitLanguage || "text";
}

function splitMarkdownParts(content: string): MarkdownPart[] {
  const normalized = normalizeLooseMath(content);
  const parts: MarkdownPart[] = [];
  let lastIndex = 0;

  for (const match of normalized.matchAll(codeFenceStartPattern)) {
    const matchIndex = match.index ?? 0;
    const fenceIndex = matchIndex + (match[1] ? 1 : 0);

    if (fenceIndex < lastIndex) {
      continue;
    }

    const before = normalized.slice(lastIndex, fenceIndex);

    if (before) {
      parts.push({ type: "markdown", content: before });
    }

    const codeStart = fenceIndex + match[0].length - (match[1]?.length ?? 0);
    const closingFenceIndex = normalized.indexOf("\n```", codeStart);
    const hasClosingFence = closingFenceIndex !== -1;
    const codeEnd = hasClosingFence ? closingFenceIndex : normalized.length;
    const code = normalized.slice(codeStart, codeEnd);

    parts.push({
      type: "code",
      content: code,
      language: inferCodeLanguage(code, match[2]),
    });

    if (!hasClosingFence) {
      lastIndex = normalized.length;
      break;
    }

    const closingFenceEnd = normalized.indexOf("\n", closingFenceIndex + 4);
    lastIndex = closingFenceEnd === -1 ? normalized.length : closingFenceEnd;
  }

  const after = normalized.slice(lastIndex);
  if (after) {
    parts.push({ type: "markdown", content: after });
  }

  return parts.length ? parts : [{ type: "markdown", content: normalized }];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const execCommand = Reflect.get(document, "execCommand");
    const copied =
      typeof execCommand === "function" ? Boolean(execCommand.call(document, "copy")) : false;
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function getCodeText(pre: HTMLPreElement): string {
  const code = pre.querySelector("code");

  if (pre.closest('[data-streamdown="code-block"]') && code) {
    const lineNodes = Array.from(code.children);
    if (lineNodes.length > 0) {
      return lineNodes.map((line) => line.textContent ?? "").join("\n").replace(/\s+$/, "");
    }
  }

  const text = code?.textContent ?? pre.textContent ?? "";
  return text.replace(/\s+$/, "");
}

function normalizeHighlightedHtml(html: string): string {
  return html
    .replace(/<pre class="shiki(?=\s|")/, '<pre class="astro-code shiki')
    .replace(
      /<pre\b(?![^>]*data-ai-copyable-code-block)/,
      `<pre ${AI_CODE_COPY_ATTR}="true" role="button" tabindex="0" title="Click to copy"`,
    );
}

function getMetaContent(name: string): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
}

function getPageContext(): PageContext {
  const main = document.querySelector("main");
  const article = main?.querySelector("article") ?? main;
  const heading = article?.querySelector("h1") ?? main?.querySelector("h1");
  const title = compactText(heading?.textContent || document.title || "Page", 160);
  const description = compactText(getMetaContent("description"), 500);
  const contentSource = article ?? main ?? document.body;
  const content = compactText(contentSource.innerText || contentSource.textContent || "", MAX_CONTEXT_LENGTH);

  return {
    path: window.location.pathname || "/",
    title,
    description,
    content,
  };
}

function getStorageKey(): string {
  return AI_GUIDE_CHAT_STORAGE_KEY;
}

function clampAiGuideWidth(width: number): number {
  const viewportWidth = window.innerWidth;
  const minWidth = Math.min(MIN_AI_GUIDE_WIDTH, Math.max(280, viewportWidth - 280));
  const maxWidth = Math.max(minWidth, Math.min(viewportWidth * 0.8, viewportWidth - 320));
  return Math.round(Math.min(maxWidth, Math.max(minWidth, width)));
}

function getStoredMessages(raw: string): OverlayMessage[] {
  const parsed = JSON.parse(raw) as { version?: number; messages?: unknown };
  if (![1, 2, AI_STORAGE_VERSION].includes(parsed.version ?? 0) || !Array.isArray(parsed.messages)) {
    return [];
  }

  return parsed.messages
    .filter((message): message is OverlayMessage => {
      return (
        typeof message === "object" &&
        message !== null &&
        "id" in message &&
        "role" in message &&
        "content" in message &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      );
    })
    .map((message) => ({
      ...message,
      content: message.role === "assistant"
        ? message.content.slice(0, 32_000).replace(emojiPattern, "")
        : message.content.slice(0, 32_000),
    }));
}

function markCopyableCodeBlocks(root: HTMLElement | null) {
  if (!root) {
    return;
  }

  for (const pre of root.querySelectorAll<HTMLPreElement>(".ai-page-code pre, .ai-page-markdown pre")) {
    pre.setAttribute(AI_CODE_COPY_ATTR, "true");
    pre.removeAttribute("data-copyable-code-block");
    pre.setAttribute("role", "button");
    pre.setAttribute("tabindex", "0");
    pre.setAttribute("title", "Click to copy");
  }
}

async function copyCodeBlock(pre: HTMLPreElement) {
  const text = getCodeText(pre);
  if (!text) {
    return;
  }

  const copied = await copyText(text);
  toast(copied ? "Copied code block" : "Could not copy code");
}

function AiTable({ children, className, node: _node, ...props }: TableProps) {
  return (
    <div className="ai-page-table">
      <table className={className} {...props}>
        {children}
      </table>
    </div>
  );
}

function AiThead({ children, className, node: _node, ...props }: SectionProps) {
  return (
    <thead className={className} {...props}>
      {children}
    </thead>
  );
}

function AiTbody({ children, className, node: _node, ...props }: SectionProps) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

function AiTr({ children, className, node: _node, ...props }: RowProps) {
  return (
    <tr className={className} {...props}>
      {children}
    </tr>
  );
}

function AiTh({ children, className, node: _node, ...props }: HeaderCellProps) {
  return (
    <th className={className} {...props}>
      {children}
    </th>
  );
}

function AiTd({ children, className, node: _node, ...props }: DataCellProps) {
  return (
    <td className={className} {...props}>
      {children}
    </td>
  );
}

function AiLink({ href, children, className, node: _node, ...props }: LinkProps) {
  if (!href) return <>{children}</>;

  try {
    const url = new URL(href, window.location.origin);
    const allowedHosts = new Set([window.location.hostname, "egeuysal.com", "www.egeuysal.com"]);
    if (url.protocol !== "https:" && url.origin !== window.location.origin) {
      return <>{children}</>;
    }
    if (!allowedHosts.has(url.hostname)) {
      return <>{children}</>;
    }
    const safeHref = `${url.pathname}${url.search}${url.hash}`;
    return (
      <a href={safeHref} className={cn("ai-guide-link", className)} {...props}>
        {children}
      </a>
    );
  } catch {
    return <>{children}</>;
  }
}

const aiMarkdownComponents: Components = {
  a: AiLink,
  table: AiTable,
  thead: AiThead,
  tbody: AiTbody,
  tr: AiTr,
  th: AiTh,
  td: AiTd,
};

function AiCodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    async function highlight(isDark: boolean) {
      try {
        const highlighted = await codeToHtml(code, {
          lang: language,
          theme: isDark ? SHIKI_DARK_THEME : SHIKI_LIGHT_THEME,
        });

        if (!cancelled) {
          setHtml(normalizeHighlightedHtml(highlighted));
        }
      } catch {
        if (!cancelled) {
          setHtml(
            `<pre class="astro-code" ${AI_CODE_COPY_ATTR}="true" role="button" tabindex="0" title="Click to copy"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`,
          );
        }
      }
    }

    setHtml(null);
    const onColorSchemeChange = (event: MediaQueryListEvent) => void highlight(event.matches);
    colorScheme.addEventListener("change", onColorSchemeChange);
    void highlight(colorScheme.matches);

    return () => {
      cancelled = true;
      colorScheme.removeEventListener("change", onColorSchemeChange);
    };
  }, [code, language]);

  if (!html) {
    return (
      <div className="ai-page-code">
        <pre
          className="astro-code"
          data-ai-copyable-code-block="true"
          role="button"
          tabIndex={0}
          title="Click to copy"
        >
          <code>{code.replace(/\n$/, "")}</code>
        </pre>
      </div>
    );
  }

  return <div className="ai-page-code" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AiMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <>
      {splitMarkdownParts(content).map((part, index) => {
        if (part.type === "code") {
          return <AiCodeBlock key={`${index}-code`} code={part.content} language={part.language} />;
        }

        return (
          <Streamdown
            key={`${index}-markdown`}
            className={cn(
              "ai-page-markdown prose prose-neutral prose-invert max-w-none break-words text-xs leading-5 prose-p:my-1.5 prose-p:text-neutral-300 prose-headings:text-neutral-100 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:text-neutral-100 prose-a:text-neutral-100 prose-a:decoration-neutral-700 prose-pre:my-1.5 prose-pre:max-w-full prose-pre:overflow-x-auto",
              className,
            )}
            mode="streaming"
            components={aiMarkdownComponents}
            controls={false}
            lineNumbers={false}
            normalizeHtmlIndentation
            plugins={{ math }}
            shikiTheme={SHIKI_STREAMDOWN_THEMES}
          >
            {part.content}
          </Streamdown>
        );
      })}
    </>
  );
}

export default function PageAiOverlay({
  openOnMount = false,
  restoreOpenOnMount = false,
}: {
  openOnMount?: boolean;
  restoreOpenOnMount?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(restoreOpenOnMount);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<OverlayMessage[]>([]);
  const [hasRestoredStorage, setHasRestoredStorage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const panelWidthRef = useRef(0);
  const hasSavedPanelWidthRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const storageKey = getStorageKey();

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    document.body.classList.toggle("ai-guide-open", isOpen);
    try {
      window.localStorage.setItem(AI_GUIDE_OPEN_STORAGE_KEY, String(isOpen));
    } catch {
      // The panel can still be used when browser storage is unavailable.
    }
    return () => document.body.classList.remove("ai-guide-open");
  }, [isOpen]);

  useEffect(() => {
    if (!restoreOpenOnMount && (openOnMount || window.localStorage.getItem(AI_GUIDE_OPEN_STORAGE_KEY) === "true")) {
      const frame = window.requestAnimationFrame(() => setIsOpen(true));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [openOnMount, restoreOpenOnMount]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    let savedWidth = 0;
    try {
      savedWidth = Number(window.localStorage.getItem(AI_GUIDE_WIDTH_STORAGE_KEY));
    } catch {
      // Use the default width when browser storage is unavailable.
    }
    hasSavedPanelWidthRef.current = Number.isFinite(savedWidth) && savedWidth > 0;
    const initialWidth = hasSavedPanelWidthRef.current
      ? (window.innerWidth <= 640 ? Math.round(savedWidth) : clampAiGuideWidth(savedWidth))
      : Math.round(window.innerWidth * 0.5);
    panelWidthRef.current = initialWidth;
    setPanelWidth(initialWidth);

    const clampOnResize = () => {
      if (window.innerWidth <= 640) return;
      const nextWidth = hasSavedPanelWidthRef.current
        ? clampAiGuideWidth(panelWidthRef.current)
        : Math.round(window.innerWidth * 0.5);
      panelWidthRef.current = nextWidth;
      setPanelWidth(nextWidth);
      if (hasSavedPanelWidthRef.current) {
        try {
          window.localStorage.setItem(AI_GUIDE_WIDTH_STORAGE_KEY, String(nextWidth));
        } catch {
          // Keep the current width for this page when storage is unavailable.
        }
      }
    };

    window.addEventListener("resize", clampOnResize);
    return () => window.removeEventListener("resize", clampOnResize);
  }, []);

  useEffect(() => {
    if (panelWidth > 0) {
      document.documentElement.style.setProperty("--ai-guide-width", `${panelWidth}px`);
    }
  }, [panelWidth]);

  useEffect(() => {
    setHasRestoredStorage(false);
    setQuestion("");
    setMessages([]);
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      let restoredMessages = raw ? getStoredMessages(raw) : [];

      if (!restoredMessages.length) {
        const migrated: OverlayMessage[] = [];
        const oldPathKeyPrefix = `${AI_GUIDE_CHAT_STORAGE_KEY}:`;
        for (let index = 0; index < window.sessionStorage.length; index += 1) {
          const key = window.sessionStorage.key(index);
          if (!key?.startsWith(oldPathKeyPrefix)) continue;
          const oldRaw = window.sessionStorage.getItem(key);
          if (!oldRaw) continue;
          try {
            migrated.push(...getStoredMessages(oldRaw));
          } catch {
            window.sessionStorage.removeItem(key);
          }
        }
        const unique = new Map(migrated.map((message) => [message.id, message]));
        restoredMessages = [...unique.values()]
          .sort((left, right) => Number.parseInt(left.id.split("-")[0], 36) - Number.parseInt(right.id.split("-")[0], 36))
          .slice(-20);
      }

      if (restoredMessages.length) setMessages(restoredMessages);

      if (raw) {
        const parsed = JSON.parse(raw) as { question?: unknown };
        if (typeof parsed.question === "string") {
          setQuestion(parsed.question.slice(0, MAX_QUESTION_LENGTH));
        }
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    } finally {
      setHasRestoredStorage(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasRestoredStorage) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasRestoredStorage, storageKey]);

  useEffect(() => {
    if (!hasRestoredStorage) {
      return;
    }

    try {
      const persistedMessages = messages.filter((message) => message.content.trim());
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          version: AI_STORAGE_VERSION,
          question,
          messages: persistedMessages,
        }),
      );
    } catch {
      // Ignore storage failures; the active chat can still continue.
    }
  }, [hasRestoredStorage, messages, question, storageKey]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages, isOpen]);

  useEffect(() => {
    markCopyableCodeBlocks(overlayRef.current);
  }, [messages, isOpen]);

  useEffect(() => {
    const root = overlayRef.current;
    if (!root) {
      return;
    }

    const observer = new MutationObserver(() => {
      markCopyableCodeBlocks(root);
    });

    markCopyableCodeBlocks(root);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  async function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const pre = target.closest<HTMLPreElement>(".ai-page-code pre, .ai-page-markdown pre");
    if (!(pre instanceof HTMLPreElement)) {
      return;
    }

    const selection = window.getSelection()?.toString();
    if (selection) {
      return;
    }

    await copyCodeBlock(pre);
  }

  async function handleOverlayKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLPreElement) || target.getAttribute(AI_CODE_COPY_ATTR) !== "true") {
      return;
    }

    event.preventDefault();
    await copyCodeBlock(target);
  }

  async function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault();

    const trimmed = question.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const context = getPageContext();

    const userMessage: OverlayMessage = { id: createId(), role: "user", content: trimmed };
    const assistantId = createId();
    setIsOpen(true);
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setQuestion("");
    setIsLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          page: context,
          history: messages
            .filter((message) => message.content.trim())
            .slice(-20)
            .map(({ role, content }) => ({ role, content: content.slice(-1_200) })),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let errorMessage = `AI request failed (${response.status})`;
        try {
          const parsed = (await response.json()) as { error?: string };
          errorMessage = parsed.error || errorMessage;
        } catch {
          // Keep the status message when the response is not JSON.
        }
        throw new Error(errorMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: `${message.content}${chunk}` }
              : message,
          ),
        );
      }

      const finalChunk = decoder.decode();
      if (finalChunk) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: `${message.content}${finalChunk}` }
              : message,
          ),
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message = error instanceof Error ? error.message : "AI request failed";
      toast.error(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId && !item.content ? { ...item, content: message } : item,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  const hasTranscript = messages.length > 0;

  function updatePanelWidthFromPointer(clientX: number) {
    const nextWidth = clampAiGuideWidth(window.innerWidth - clientX);
    panelWidthRef.current = nextWidth;
    setPanelWidth(nextWidth);
  }

  function finishPanelResize() {
    document.body.classList.remove("ai-guide-resizing");
    hasSavedPanelWidthRef.current = true;
    try {
      window.localStorage.setItem(AI_GUIDE_WIDTH_STORAGE_KEY, String(panelWidthRef.current));
    } catch {
      // Keep the current width for this page when storage is unavailable.
    }
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    const nextWidth = clampAiGuideWidth(panelWidthRef.current + direction * 24);
    panelWidthRef.current = nextWidth;
    setPanelWidth(nextWidth);
    hasSavedPanelWidthRef.current = true;
    try {
      window.localStorage.setItem(AI_GUIDE_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Keep the current width for this page when storage is unavailable.
    }
  }

  return (
    <>
      <aside
        className="ai-guide-panel"
        data-open={isOpen}
        aria-label="Ask AI"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
          <div
            className="ai-guide-resizer"
            role="separator"
            aria-label="Resize Ask AI panel"
            aria-orientation="vertical"
            aria-valuemin={MIN_AI_GUIDE_WIDTH}
            aria-valuenow={panelWidth || MIN_AI_GUIDE_WIDTH}
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onPointerDown={(event) => {
              if (window.innerWidth <= 640) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              document.body.classList.add("ai-guide-resizing");
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                updatePanelWidthFromPointer(event.clientX);
              }
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              finishPanelResize();
            }}
            onPointerCancel={finishPanelResize}
            onLostPointerCapture={finishPanelResize}
          />
          <div className="ai-guide-panel-header">
          <p>ask ai</p>
            <button type="button" onClick={() => setIsOpen(false)} aria-label="Close Ask AI">close</button>
          </div>
          <p className="ai-guide-intro">Ask anything about the public blog, diary, and photo archive. I’ll search the sources and build a reading path.</p>
          <div
            ref={overlayRef}
            className="ai-guide-conversation"
            onClick={(event) => void handleOverlayClick(event)}
            onKeyDown={(event) => void handleOverlayKeyDown(event)}
          >
            {hasTranscript ? (
              <div ref={transcriptRef} className="ai-guide-transcript">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn("ai-guide-message", message.role === "user" && "ai-guide-user-message")}
                  >
                    {message.content ? (
                      <AiMarkdown content={message.content} className={message.role === "user" ? "prose-p:!my-0" : undefined} />
                    ) : (
                      <span className="ai-guide-thinking"><Spinner className="size-3" /> searching the archive…</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="ai-guide-empty">I’ll look across published posts and photo stories, then link the sources I used.</p>
            )}
          </div>
          <form className="ai-guide-form" onSubmit={(event) => void handleSubmit(event)}>
            <input
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              maxLength={MAX_QUESTION_LENGTH}
              className="ai-guide-input"
              placeholder="What do you want to learn?"
              aria-label="Ask AI"
            />
            <button type="submit" disabled={!question.trim() || isLoading} aria-label="Send question">
              {isLoading ? <Spinner /> : ">"}
            </button>
          </form>
      </aside>
      {!isOpen ? (
        <button className="ai-guide-launcher" type="button" onClick={() => setIsOpen(true)}>
          ask ai
        </button>
      ) : null}
    </>
  );
}
