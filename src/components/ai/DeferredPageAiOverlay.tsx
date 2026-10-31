import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import aiStylesheetUrl from "@/styles/page-ai-overlay.css?url";
import {
  AI_GUIDE_OPEN_STORAGE_KEY,
  AI_GUIDE_WIDTH_STORAGE_KEY,
} from "@/lib/ai-preferences";

const PageAiOverlay = lazy(() => import("@/components/ai/PageAiOverlay"));

class OverlayLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    document.body.classList.remove("ai-guide-open");
    document.documentElement.classList.remove("ai-guide-restoring");
    try {
      window.localStorage.setItem(AI_GUIDE_OPEN_STORAGE_KEY, "false");
    } catch {
      // Keep the page usable when browser storage is unavailable.
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="fixed bottom-4 right-4 z-[100] rounded-sm border border-neutral-700 bg-bg px-3 py-2 text-xs text-neutral-300"
        >
          reload ask ai
        </button>
      );
    }
    return this.props.children;
  }
}

export default function DeferredPageAiOverlay() {
  const [isRequested, setIsRequested] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadOverlay = useCallback(async ({ restore = false }: { restore?: boolean } = {}) => {
    if (restore) {
      setRestoreOpen(true);
      document.documentElement.classList.add("ai-guide-restoring");
      try {
        const savedWidth = Number(window.localStorage.getItem(AI_GUIDE_WIDTH_STORAGE_KEY));
        if (Number.isFinite(savedWidth) && savedWidth > 0) {
          document.documentElement.style.setProperty("--ai-guide-width", `${savedWidth}px`);
        }
      } catch {
        // Restore with the default width when browser storage is unavailable.
      }
      document.body.classList.add("ai-guide-open");
    }

    if (!document.querySelector('link[data-page-ai-styles="true"]')) {
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = aiStylesheetUrl;
        link.dataset.pageAiStyles = "true";
        link.onload = () => resolve();
        link.onerror = () => {
          link.remove();
          reject(new Error("Ask AI styles failed to load"));
        };
        document.head.append(link);
      });
    }
    setIsRequested(true);
    setLoadFailed(false);
    if (restore) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.documentElement.classList.remove("ai-guide-restoring");
        });
      });
    }
  }, []);

  const requestOverlay = () => {
    void loadOverlay().catch(() => {
      setIsRequested(false);
      setLoadFailed(true);
    });
  };

  useEffect(() => {
    const restoreOpenGuide = () => {
      if (window.localStorage.getItem(AI_GUIDE_OPEN_STORAGE_KEY) === "true") {
        void loadOverlay({ restore: true }).catch(() => {
          document.body.classList.remove("ai-guide-open");
          document.documentElement.classList.remove("ai-guide-restoring");
          setLoadFailed(true);
        });
      }
    };

    restoreOpenGuide();
    document.addEventListener("astro:page-load", restoreOpenGuide);
    return () => document.removeEventListener("astro:page-load", restoreOpenGuide);
  }, [loadOverlay]);

  return (
    <>
      {!isRequested && (
        <button
          type="button"
          onClick={requestOverlay}
          className="fixed bottom-4 right-4 z-[100] rounded-sm border border-neutral-700 bg-bg px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-neutral-400 hover:text-neutral-100"
        >
          {loadFailed ? "retry ask ai" : "ask ai"}
        </button>
      )}
      {isRequested && (
        <OverlayLoadBoundary>
          <Suspense fallback={
            <button
              type="button"
              disabled
              className="fixed bottom-4 right-4 z-[100] rounded-sm border border-neutral-700 bg-bg px-3 py-2 text-xs text-neutral-300"
            >
              loading ask ai…
            </button>
          }>
            <PageAiOverlay openOnMount={!restoreOpen} restoreOpenOnMount={restoreOpen} />
          </Suspense>
        </OverlayLoadBoundary>
      )}
    </>
  );
}
