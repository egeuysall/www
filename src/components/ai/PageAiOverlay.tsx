import { useEffect, useRef, useState } from "react";
import { math } from "@streamdown/math";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { SHIKI_STREAMDOWN_THEMES, SHIKI_THEMES } from "@/lib/code-themes.mjs";

import "katex/dist/katex.min.css";
import "streamdown/styles.css";

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

const AI_STORAGE_VERSION = 1;
const MAX_QUESTION_LENGTH = 800;
const MAX_CONTEXT_LENGTH = 24_000;
const AI_CODE_COPY_ATTR = "data-ai-copyable-code-block";
const looseMathPattern = /\(([^()\n]*(?:\\[a-zA-Z]+|[_^{}=+\-*/]|[∫√π∞])[^()\n]*)\)/g;
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
  if (explicitLanguage && explicitLanguage !== "text") {
    return explicitLanguage;
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

function getStorageKey(path: string): string {
  return `egeuysal:www-ai:${path}`;
}

function isAiOverlayPath(path: string): boolean {
  return /^\/(?:blog|diary|photo)\/[^/]+\/?$/.test(path);
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

const aiMarkdownComponents: Components = {
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

    async function highlight() {
      try {
        const { codeToHtml } = await import("shiki");
        const highlighted = await codeToHtml(code, {
          lang: language,
          themes: SHIKI_THEMES,
          defaultColor: false,
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
    void highlight();

    return () => {
      cancelled = true;
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

export default function PageAiOverlay() {
  const [pagePath, setPagePath] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname || "/",
  );
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<OverlayMessage[]>([]);
  const [hasRestoredStorage, setHasRestoredStorage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const storageKey = getStorageKey(pagePath);

  useEffect(() => {
    const syncPagePath = () => {
      setPagePath(window.location.pathname || "/");
    };

    syncPagePath();
    document.addEventListener("astro:page-load", syncPagePath);

    return () => {
      document.removeEventListener("astro:page-load", syncPagePath);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setHasRestoredStorage(false);
    setQuestion("");
    setMessages([]);
    setIsOpen(false);

    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        version?: number;
        question?: unknown;
        messages?: unknown;
      };

      if (parsed.version !== AI_STORAGE_VERSION) {
        return;
      }

      if (typeof parsed.question === "string") {
        setQuestion(parsed.question.slice(0, MAX_QUESTION_LENGTH));
      }

      if (Array.isArray(parsed.messages)) {
        const restoredMessages = parsed.messages
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
          .slice(-20)
          .map((message) => ({
            ...message,
            content: message.content.slice(0, 32_000),
          }));

        setMessages(restoredMessages);
        setIsOpen(restoredMessages.length > 0);
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
    if (!context.content) {
      toast.error("No page context found");
      return;
    }

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
        body: JSON.stringify({ question: trimmed, page: context }),
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

  if (!isAiOverlayPath(pagePath)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[100] flex justify-center px-3 sm:bottom-5">
      <div
        ref={overlayRef}
        className="pointer-events-auto w-full max-w-[32rem]"
        onClick={(event) => void handleOverlayClick(event)}
        onKeyDown={(event) => void handleOverlayKeyDown(event)}
      >
        {isOpen && hasTranscript ? (
          <div className="mb-1.5 rounded-sm border border-line bg-bg text-fg">
            <div
              ref={transcriptRef}
              className="max-h-[min(28rem,58vh)] overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 py-2"
            >
              <div className="flex flex-col gap-2">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-full text-xs leading-5",
                      message.role === "user"
                        ? "ml-auto max-w-[90%] rounded-sm border border-line px-2 py-1.5 text-fg"
                        : "text-muted",
                    )}
                  >
                    {message.content ? (
                      <AiMarkdown
                        content={message.content}
                        className={
                          message.role === "user"
                            ? "prose-p:!my-0 prose-p:!leading-4 prose-pre:!my-0"
                            : undefined
                        }
                      />
                    ) : (
                      <span className="text-neutral-500">thinking...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex min-h-10 items-center gap-2 rounded-sm border border-line bg-bg px-2 py-1.5">
            <input
              ref={inputRef}
              value={question}
              onFocus={() => {
                if (hasTranscript) setIsOpen(true);
              }}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              maxLength={MAX_QUESTION_LENGTH}
              className="h-7 min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-sm text-fg shadow-none outline-none ring-0 placeholder:text-muted focus:border-transparent focus:shadow-none focus:outline-none focus:ring-0 focus-visible:border-transparent focus-visible:shadow-none focus-visible:outline-none focus-visible:ring-0"
              placeholder="Ask AI"
              aria-label="Ask AI about this page"
            />
            <button
              type="submit"
              disabled={!question.trim() || isLoading}
              className="shrink-0 px-1 font-mono text-sm text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send question"
            >
              {isLoading ? "..." : ">"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
