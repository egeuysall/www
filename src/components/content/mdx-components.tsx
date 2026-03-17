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
};

function getYouTubeVideoId(input: string): string | null {
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

  if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
    return null;
  }

  return videoId;
}

function getYouTubeEmbedUrl(videoId: string): string {
  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  embedUrl.searchParams.set("autoplay", "1");
  embedUrl.searchParams.set("loop", "1");
  embedUrl.searchParams.set("playlist", videoId);
  embedUrl.searchParams.set("mute", "1");
  embedUrl.searchParams.set("controls", "0");
  embedUrl.searchParams.set("modestbranding", "1");
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("iv_load_policy", "3");
  embedUrl.searchParams.set("enablejsapi", "1");

  return embedUrl.toString();
}

function getYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function YouTubeVideo({
  url,
  title = "Embedded YouTube video",
}: YouTubeVideoProps) {
  const videoId = getYouTubeVideoId(url);

  if (!videoId) {
    return <p className="text-sm text-neutral-400">Invalid YouTube URL.</p>;
  }

  const source = getYouTubeEmbedUrl(videoId);
  const watchUrl = getYouTubeWatchUrl(videoId);
  const thumbnailUrl = getYouTubeThumbnailUrl(videoId);
  const instanceId = `yt-${videoId}-${Math.random().toString(36).slice(2, 9)}`;
  const fallbackScript = `
    (() => {
      const root = document.getElementById(${JSON.stringify(instanceId)});
      if (!root) return;

      const frame = root.querySelector("iframe");
      const fallbackOverlay = root.querySelector("[data-yt-fallback-overlay]");
      if (!frame || !fallbackOverlay) return;

      let resolved = false;

      const reveal = () => {
        if (resolved) return;
        resolved = true;
        frame.classList.add("hidden");
        fallbackOverlay.classList.remove("hidden");
        cleanup();
      };

      const hide = () => {
        if (resolved) return;
        resolved = true;
        frame.classList.remove("hidden");
        fallbackOverlay.classList.add("hidden");
        cleanup();
      };

      const checkFrameState = () => {
        if (resolved) return;
        try {
          const href = frame.contentWindow?.location?.href || "";
          if (!href || href === "about:blank") {
            reveal();
            return;
          }
        } catch {
          // Cross-origin frame content cannot be inspected reliably.
          // Wait for YouTube postMessage events or timeout-based fallback.
          return;
        }
        hide();
      };

      const onMessage = (event) => {
        const origin = String(event.origin || "");
        if (!origin.includes("youtube.com") && !origin.includes("youtube-nocookie.com")) {
          return;
        }

        const payload = typeof event.data === "string"
          ? event.data
          : JSON.stringify(event.data ?? {});

        if (
          payload.includes("onReady") ||
          payload.includes("infoDelivery") ||
          payload.includes("playerReady")
        ) {
          hide();
        }
      };

      const quickTimeout = window.setTimeout(checkFrameState, 1000);
      const hardTimeout = window.setTimeout(reveal, 2500);

      const cleanup = () => {
        window.clearTimeout(quickTimeout);
        window.clearTimeout(hardTimeout);
        window.removeEventListener("message", onMessage);
      };

      window.addEventListener("message", onMessage);
      frame.addEventListener("load", checkFrameState, { once: true });
      frame.addEventListener("error", reveal, { once: true });
    })();
  `;

  return (
    <div
      id={instanceId}
      className="not-prose my-6 overflow-hidden rounded-sm border border-neutral-800 bg-neutral-950"
    >
      <div className="relative aspect-video w-full">
        <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />

        <iframe
          src={source}
          title={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-transparent"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />

        <div
          data-yt-fallback-overlay
          className="hidden absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center"
        >
          <p className="text-sm text-neutral-200">
            This video could not be loaded in your browser.
          </p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-neutral-300 underline decoration-neutral-500 underline-offset-2 transition-colors hover:text-neutral-100"
          >
            Watch on YouTube
          </a>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: fallbackScript }} />
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
      className="not-prose my-6 overflow-hidden rounded-sm border border-neutral-800"
      {...props}
    />
  ),
  YouTubeVideo,
};
