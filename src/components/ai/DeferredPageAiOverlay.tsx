import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import aiStylesheetUrl from "@/styles/page-ai-overlay.css?url";
import {
  AI_GUIDE_OPEN_STORAGE_KEY,
  AI_GUIDE_WIDTH_STORAGE_KEY,
} from "@/lib/ai-preferences";

const PageAiOverlay = lazy(() => import("@/components/ai/PageAiOverlay"));

export default function DeferredPageAiOverlay() {
  const [isRequested, setIsRequested] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

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
      await new Promise<void>((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = aiStylesheetUrl;
        link.dataset.pageAiStyles = "true";
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.append(link);
      });
    }
    setIsRequested(true);
    if (restore) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.documentElement.classList.remove("ai-guide-restoring");
        });
      });
    }
  }, []);

  useEffect(() => {
    const restoreOpenGuide = () => {
      if (window.sessionStorage.getItem(AI_GUIDE_OPEN_STORAGE_KEY) === "true") {
        void loadOverlay({ restore: true });
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
          onClick={() => void loadOverlay()}
          className="fixed bottom-4 right-4 z-[100] rounded-sm border border-neutral-700 bg-bg px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-neutral-400 hover:text-neutral-100"
        >
          ask ai
        </button>
      )}
      {isRequested && (
        <Suspense fallback={null}>
          <PageAiOverlay openOnMount={!restoreOpen} restoreOpenOnMount={restoreOpen} />
        </Suspense>
      )}
    </>
  );
}
