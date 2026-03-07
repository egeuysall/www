import { cn } from "@/lib/utils";
import type { MDXComponents } from "mdx/types";

export const mdxComponents: MDXComponents = {
  a: ({ href = "", ...props }) => {
    const isExternal = /^https?:\/\//.test(String(href));

    return (
      <a
        href={String(href)}
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
