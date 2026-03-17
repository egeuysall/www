"use client";

import { useEffect } from "react";
import { prefetchImageSet } from "@/lib/client/image-cache";

type Props = {
  nextPageHref?: string;
  nextPageImageUrls?: string[];
  maxNetworkWidth?: number;
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
      { timeout: 1500 },
    );

    return () => {
      idleApi.cancelIdleCallback?.(idleId);
    };
  }

  const timeoutId = setTimeout(task, 120);
  return () => {
    clearTimeout(timeoutId);
  };
}

export default function PhotoGalleryPrefetch({
  nextPageHref,
  nextPageImageUrls = [],
  maxNetworkWidth = 1350,
}: Props) {
  const nextUrlsKey = nextPageImageUrls.join("|");

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

      if (nextPageImageUrls.length > 0) {
        void prefetchImageSet(nextPageImageUrls, {
          maxNetworkWidth,
        });
      }
    });

    return cleanup;
  }, [maxNetworkWidth, nextPageHref, nextUrlsKey, nextPageImageUrls]);

  return null;
}
