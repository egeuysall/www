import { cn } from "@/lib/utils";
import type { MDXComponents } from "mdx/types";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

function getSafeHref(input: string): string {
  const href = input.trim();

  if (!href) {
    return "#";
  }

  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../")
  ) {
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

function getSafeEmbedUrl(
  input: string,
  allowedHosts: Set<string>,
): string | null {
  const href = input.trim();

  if (!href) {
    return null;
  }

  try {
    const parsed = new URL(href);

    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (!allowedHosts.has(hostname)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

type YouTubeVideoProps = {
  url: string;
  title?: string;
  height?: number;
};

function getYouTubeEmbedUrl(input: string): string | null {
  const safeUrl = getSafeEmbedUrl(input, YOUTUBE_HOSTS);

  if (!safeUrl) {
    return null;
  }

  const parsed = new URL(safeUrl);
  let videoId = "";

  if (parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (parsed.pathname.startsWith("/watch")) {
    videoId = parsed.searchParams.get("v") ?? "";
  } else if (parsed.pathname.startsWith("/embed/")) {
    videoId = parsed.pathname.split("/")[2] ?? "";
  }

  if (!videoId) {
    return null;
  }

  const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
  embedUrl.searchParams.set("autoplay", "1");
  embedUrl.searchParams.set("loop", "1");
  embedUrl.searchParams.set("playlist", videoId);
  embedUrl.searchParams.set("mute", "1");
  embedUrl.searchParams.set("controls", "0");
  embedUrl.searchParams.set("modestbranding", "1");
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("iv_load_policy", "3");

  return embedUrl.toString();
}

function YouTubeVideo({
  url,
  title = "Embedded YouTube video",
  height = 312,
}: YouTubeVideoProps) {
  const source = getYouTubeEmbedUrl(url);

  if (!source) {
    return <p>Invalid YouTube URL.</p>;
  }

  return (
    <div className="not-prose my-6 overflow-hidden rounded-sm border border-neutral-800">
      <iframe
        src={source}
        title={title}
        loading="lazy"
        className="w-full"
        height={height}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
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
  YouTubeVideo,
};
