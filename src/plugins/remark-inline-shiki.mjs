import { codeToHtml } from "shiki";

const LANGUAGE_PREFIX_PATTERN = /^([a-zA-Z0-9_+-]+):(.*)$/s;
const SHELL_COMMAND_PATTERN =
  /^(?:\$ ?)?(?:pnpm|npm|yarn|bun|git|docker|kubectl|go|cargo|python|node|npx|cd|ls|cat|grep|sed|awk|rm|cp|mv|mkdir|touch|chmod|chown|ssh|curl|wget)\b/i;
const CODE_LIKE_PATTERN =
  /=>|[{}()[\];]|(?:^|\s)(?:function|const|let|var|class|interface|type|return|import|export|await|async|new)\b/;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function walk(tree, visitor) {
  const stack = [{ node: tree, parent: null, index: -1 }];

  while (stack.length > 0) {
    const { node, parent, index } = stack.pop();
    visitor(node, parent, index);

    if (!node || !Array.isArray(node.children)) continue;
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: node.children[i], parent: node, index: i });
    }
  }
}

function extractInlineCodeFromShiki(html) {
  const codeMatch = html.match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/i);
  if (!codeMatch) return null;

  const rawCodeHtml = codeMatch[1];
  const linePrefix = '<span class="line">';
  if (!rawCodeHtml.includes(linePrefix)) return rawCodeHtml;

  const lines = rawCodeHtml
    .split(linePrefix)
    .slice(1)
    .map((lineHtml) => {
      const lineEnd = lineHtml.lastIndexOf("</span>");
      return lineEnd === -1 ? lineHtml : lineHtml.slice(0, lineEnd);
    });

  return lines.join("\n");
}

function inferInlineLanguage(rawValue, defaultLang) {
  const value = rawValue.trim();
  if (!value) return defaultLang;
  if (SHELL_COMMAND_PATTERN.test(value)) return "bash";
  if (CODE_LIKE_PATTERN.test(value)) return "ts";
  return defaultLang;
}

function resolveInlineLanguage(rawValue, defaultLang) {
  const prefixed = rawValue.match(LANGUAGE_PREFIX_PATTERN);
  if (!prefixed || !prefixed[2].trim()) {
    return { lang: inferInlineLanguage(rawValue, defaultLang), code: rawValue };
  }

  return {
    lang: prefixed[1].toLowerCase(),
    code: prefixed[2].trimStart(),
  };
}

export default function remarkInlineShiki(options = {}) {
  const theme = options.theme ?? "github-dark-high-contrast";
  const themes = options.themes;
  const defaultColor = options.defaultColor ?? false;
  const defaultLang = options.defaultLang ?? "txt";
  const hasThemeVariants =
    themes && typeof themes === "object" && Object.keys(themes).length > 0;

  const getHighlightOptions = (lang) =>
    hasThemeVariants
      ? { lang, themes, defaultColor }
      : { lang, theme };

  return async function transformer(tree) {
    const replacements = [];

    walk(tree, (node, parent, index) => {
      if (!node || node.type !== "inlineCode" || !parent || index < 0) return;
      replacements.push({ node, parent, index });
    });

    await Promise.all(
      replacements.map(async ({ node, parent, index }) => {
        const { lang, code } = resolveInlineLanguage(node.value, defaultLang);
        let renderedLang = lang;
        const isPlainTextLang = lang === "txt" || lang === "text";

        let highlighted = "";
        if (isPlainTextLang) {
          highlighted = escapeHtml(code);
        } else {
          try {
            const html = await codeToHtml(code, getHighlightOptions(lang));
            highlighted = extractInlineCodeFromShiki(html) ?? "";
          } catch {
            renderedLang = defaultLang;
            try {
              const html = await codeToHtml(
                code,
                getHighlightOptions(defaultLang),
              );
              highlighted = extractInlineCodeFromShiki(html) ?? "";
            } catch {
              highlighted = escapeHtml(code);
            }
          }
        }

        if (!highlighted) highlighted = escapeHtml(code);

        parent.children[index] = {
          type: "html",
          value: `<code class="inline-code shiki-inline" data-lang="${renderedLang}">${highlighted}</code>`,
        };
      }),
    );
  };
}
