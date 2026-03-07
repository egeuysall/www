import { cn } from "@/lib/utils";
import type { MDXComponents } from "mdx/types";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function getSafeHref(input: string): string {
  const href = input.trim();

  if (!href) {
    return "#";
  }

  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
    return href;
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href);

  if (!hasProtocol) {
    return href;
  }

  try {
    const parsed = new URL(href);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? href : "#";
  } catch {
    return "#";
  }
}

export const mdxComponents: MDXComponents = {
  a: ({ href = "", ...props }) => {
    const safeHref = getSafeHref(String(href));
    const isExternal = /^https?:\/\//i.test(safeHref);

    return (
      <a
        href={safeHref}
        {...(isExternal
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        className="underline decoration-neutral-700 underline-offset-4 transition-colors hover:text-neutral-100"
        {...props}
      />
    );
  },
  img: ({ src = "", alt = "", className, ...props }) => (
    <img
      src={String(src)}
      alt={String(alt)}
      loading="lazy"
      decoding="async"
      className={cn("rounded-sm", className)}
      {...props}
    />
  ),
};
