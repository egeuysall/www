"use client";

import { useEffect } from "react";

type Props = {
  nextPageHref?: string;
};

function scheduleIdleTask(task: () => void): () => void {
  const idleApi = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (
    typeof idleApi.requestIdleCallback === "function" &&
    typeof idleApi.cancelIdleCallback === "function"
  ) {
    const idleId = idleApi.requestIdleCallback(
      () => {
        task();
      },
      { timeout: 4000 },
    );

    return () => {
      idleApi.cancelIdleCallback?.(idleId);
    };
  }

  const timeoutId = setTimeout(task, 1800);
  return () => {
    clearTimeout(timeoutId);
  };
}

export default function PhotoGalleryPrefetch({
  nextPageHref,
}: Props) {
  useEffect(() => {
    const cleanup = scheduleIdleTask(() => {
      if (nextPageHref) {
        const nextUrl = new URL(nextPageHref, window.location.href);

        if (nextUrl.origin === window.location.origin) {
          void fetch(nextUrl.toString(), {
            credentials: "same-origin",
            cache: "force-cache",
          }).catch(() => {
            // Ignore page prefetch failures.
          });
        }
      }
    });

    return cleanup;
  }, [nextPageHref]);

  return null;
}
