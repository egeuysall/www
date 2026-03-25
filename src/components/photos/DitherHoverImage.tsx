"use client";

import { useEffect, useRef, type FC } from "react";
import {
  buildDitherCacheKey,
  getCachedDitherBitmap,
  storeDitherCanvas,
} from "@/lib/client/dither-output-cache";
import { getCachedImageBlob } from "@/lib/client/image-cache";

type ObjectFitMode = "cover" | "contain" | "fill" | "none";

interface DitherShaderProps {
  src: string;
  className?: string;
  objectFit?: ObjectFitMode;
  maxResizeWidth?: number;
  maxResizeHeight?: number;
  processingWidth?: number;
  threshold?: number;
  brightness?: number;
  contrast?: number;
  invert?: boolean;
}

interface DitherRequest {
  bitmap: ImageBitmap;
  targetWidth: number;
  targetHeight: number;
  maxResizeWidth: number;
  maxResizeHeight: number;
  processingWidth: number;
  objectFit: ObjectFitMode;
  threshold: number;
  brightness: number;
  contrast: number;
  invert: boolean;
}

type WorkerResponse =
  | {
      ok: true;
      bitmap: ImageBitmap;
    }
  | {
      ok: false;
      error: string;
    };

const BAYER_MATRIX_4X4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const MAX_PARALLEL_WORKER_JOBS = 2;
let activeWorkerJobs = 0;
const waitingWorkerJobs: Array<() => void> = [];

async function acquireWorkerSlot(): Promise<() => void> {
  if (activeWorkerJobs < MAX_PARALLEL_WORKER_JOBS) {
    activeWorkerJobs += 1;
    return () => {
      activeWorkerJobs -= 1;
      const next = waitingWorkerJobs.shift();
      if (next) next();
    };
  }

  return new Promise((resolve) => {
    waitingWorkerJobs.push(() => {
      activeWorkerJobs += 1;
      resolve(() => {
        activeWorkerJobs -= 1;
        const next = waitingWorkerJobs.shift();
        if (next) next();
      });
    });
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp255(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function fitInside(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 1, height: 1 };
  }

  const scale = Math.min(
    1,
    Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight),
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function drawWithObjectFit(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  objectFit: ObjectFitMode,
): void {
  let drawWidth = targetWidth;
  let drawHeight = targetHeight;
  let dx = 0;
  let dy = 0;

  if (objectFit === "cover") {
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    drawWidth = Math.round(sourceWidth * scale);
    drawHeight = Math.round(sourceHeight * scale);
    dx = Math.round((targetWidth - drawWidth) * 0.5);
    dy = Math.round((targetHeight - drawHeight) * 0.5);
  } else if (objectFit === "contain") {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    drawWidth = Math.round(sourceWidth * scale);
    drawHeight = Math.round(sourceHeight * scale);
    dx = Math.round((targetWidth - drawWidth) * 0.5);
    dy = Math.round((targetHeight - drawHeight) * 0.5);
  } else if (objectFit === "none") {
    drawWidth = sourceWidth;
    drawHeight = sourceHeight;
    dx = Math.round((targetWidth - drawWidth) * 0.5);
    dy = Math.round((targetHeight - drawHeight) * 0.5);
  }

  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
}

function applyOrderedBayerDither(
  imageData: ImageData,
  threshold: number,
  brightness: number,
  contrast: number,
  invert: boolean,
): void {
  const data = imageData.data;
  const width = imageData.width;
  const thresholdShift = clamp(threshold, 0, 1) - 0.5;
  const contrastValue = Math.max(0, contrast);
  const brightnessOffset = brightness * 255;

  for (let y = 0; y < imageData.height; y += 1) {
    const matrixRowOffset = (y & 3) * 4;

    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3] ?? 0;

      if (alpha < 8) {
        data[idx + 3] = 0;
        continue;
      }

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;

      const luma = clamp255(
        (0.299 * r + 0.587 * g + 0.114 * b - 128) * contrastValue +
          128 +
          brightnessOffset,
      );

      const matrixValue = (BAYER_MATRIX_4X4[matrixRowOffset + (x & 3)] + 0.5) / 16;
      // Add a tiny deterministic noise offset to break visible Bayer mesh artifacts.
      const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const jitter = ((hash & 255) / 255 - 0.5) * 0.18;
      const cutoff = clamp(matrixValue + thresholdShift + jitter, 0, 1) * 255;

      let out = luma < cutoff ? 0 : 255;
      if (invert) {
        out = 255 - out;
      }

      data[idx] = out;
      data[idx + 1] = out;
      data[idx + 2] = out;
      data[idx + 3] = alpha;
    }
  }
}

async function runDitherOnMainThread(request: DitherRequest): Promise<ImageBitmap> {
  const { bitmap } = request;

  try {
    const resizedSize = fitInside(
      bitmap.width,
      bitmap.height,
      request.maxResizeWidth,
      request.maxResizeHeight,
    );

    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = resizedSize.width;
    resizedCanvas.height = resizedSize.height;

    const resizedCtx = resizedCanvas.getContext("2d", { willReadFrequently: true });
    if (!resizedCtx) {
      throw new Error("Failed to create resize context.");
    }

    resizedCtx.imageSmoothingEnabled = true;
    resizedCtx.imageSmoothingQuality = "high";
    resizedCtx.drawImage(bitmap, 0, 0, resizedSize.width, resizedSize.height);

    const clampedProcessingWidth = clamp(Math.round(request.processingWidth), 128, 384);
    const processWidth = Math.max(1, Math.min(resizedSize.width, clampedProcessingWidth));
    const processHeight = Math.max(
      1,
      Math.round((resizedSize.height * processWidth) / resizedSize.width),
    );

    const processCanvas = document.createElement("canvas");
    processCanvas.width = processWidth;
    processCanvas.height = processHeight;

    const processCtx = processCanvas.getContext("2d", { willReadFrequently: true });
    if (!processCtx) {
      throw new Error("Failed to create processing context.");
    }

    processCtx.imageSmoothingEnabled = true;
    processCtx.imageSmoothingQuality = "medium";
    processCtx.drawImage(resizedCanvas, 0, 0, processWidth, processHeight);

    const imageData = processCtx.getImageData(0, 0, processWidth, processHeight);
    applyOrderedBayerDither(
      imageData,
      request.threshold,
      request.brightness,
      request.contrast,
      request.invert,
    );
    processCtx.putImageData(imageData, 0, 0);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = request.targetWidth;
    outputCanvas.height = request.targetHeight;

    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) {
      throw new Error("Failed to create output context.");
    }

    outputCtx.clearRect(0, 0, request.targetWidth, request.targetHeight);
    outputCtx.imageSmoothingEnabled = false;
    drawWithObjectFit(
      outputCtx,
      processCanvas,
      processWidth,
      processHeight,
      request.targetWidth,
      request.targetHeight,
      request.objectFit,
    );

    return await createImageBitmap(outputCanvas);
  } finally {
    bitmap.close();
  }
}

async function runDitherInWorker(
  request: DitherRequest,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  if (typeof Worker === "undefined") {
    request.bitmap.close();
    throw new Error("Worker API is not available.");
  }

  const releaseSlot = await acquireWorkerSlot();

  if (signal.aborted) {
    releaseSlot();
    request.bitmap.close();
    throw new DOMException("Aborted", "AbortError");
  }

  const worker = new Worker(new URL("./dither-worker.ts", import.meta.url), {
    type: "module",
  });

  const dispose = () => {
    worker.terminate();
    releaseSlot();
  };

  try {
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const onAbort = () => {
        try {
          request.bitmap.close();
        } catch {
          // Ignore close failures when bitmap ownership has already transferred.
        }
        dispose();
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal.addEventListener("abort", onAbort, { once: true });

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        signal.removeEventListener("abort", onAbort);
        const payload = event.data;

        if (!payload.ok) {
          dispose();
          reject(new Error(payload.error));
          return;
        }

        resolve(payload.bitmap);
        dispose();
      };

      worker.onerror = (event: ErrorEvent) => {
        signal.removeEventListener("abort", onAbort);
        dispose();
        reject(new Error(event.message || "Dither worker failed."));
      };

      worker.postMessage(request, [request.bitmap]);
    });
  } catch (error) {
    throw error;
  }
}

export const DitherShader: FC<DitherShaderProps> = ({
  src,
  objectFit = "cover",
  maxResizeWidth = 1350,
  maxResizeHeight = 1080,
  processingWidth = 288,
  threshold = 0.5,
  brightness = 0,
  contrast = 1,
  invert = false,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return;
    }

    let started = false;
    let didUnmount = false;
    const controller = new AbortController();

    const getHostImage = (): HTMLImageElement | null => {
      const host = container.closest("astro-island")?.parentElement ?? container.parentElement;
      if (!host) {
        return null;
      }

      const candidate = host.querySelector("img");
      return candidate instanceof HTMLImageElement ? candidate : null;
    };

    const waitForImageReady = async (image: HTMLImageElement): Promise<void> => {
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Failed to read source image for dither rendering."));
        };
        const onAbort = () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };

        const cleanup = () => {
          image.removeEventListener("load", onLoad);
          image.removeEventListener("error", onError);
          controller.signal.removeEventListener("abort", onAbort);
        };

        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    };

    const renderOnce = async () => {
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.round(rect.width);
      const cssHeight = Math.round(rect.height);

      if (cssWidth <= 0 || cssHeight <= 0) {
        return;
      }

      // Use integer DPR for crisp rendering on HiDPI screens without fractional resampling artifacts.
      const dpr = clamp(Math.round(window.devicePixelRatio || 1), 1, 2);
      const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
      const targetHeight = Math.max(1, Math.round(cssHeight * dpr));

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      context.imageSmoothingEnabled = false;

      const ditherCacheKey = buildDitherCacheKey({
        src,
        targetWidth,
        targetHeight,
        maxResizeWidth,
        maxResizeHeight,
        processingWidth,
        objectFit,
        threshold,
        brightness,
        contrast,
        invert,
      });

      const cachedBitmap = await getCachedDitherBitmap(ditherCacheKey);
      if (cachedBitmap) {
        if (didUnmount || controller.signal.aborted) {
          cachedBitmap.close();
          return;
        }

        context.clearRect(0, 0, targetWidth, targetHeight);
        context.drawImage(cachedBitmap, 0, 0, targetWidth, targetHeight);
        cachedBitmap.close();
        return;
      }

      const buildRequest = async (): Promise<DitherRequest> => ({
        bitmap: await (async () => {
          const hostImage = getHostImage();
          if (hostImage) {
            await waitForImageReady(hostImage);
            return await createImageBitmap(hostImage);
          }

          const blob = await getCachedImageBlob(src, {
            maxNetworkWidth: maxResizeWidth,
            signal: controller.signal,
          });
          return await createImageBitmap(blob);
        })(),
        targetWidth,
        targetHeight,
        maxResizeWidth,
        maxResizeHeight,
        processingWidth,
        objectFit,
        threshold,
        brightness,
        contrast,
        invert,
      });

      let outputBitmap: ImageBitmap | null = null;

      try {
        outputBitmap = await runDitherInWorker(await buildRequest(), controller.signal);
      } catch (workerError) {
        if (controller.signal.aborted) {
          throw workerError;
        }

        outputBitmap = await runDitherOnMainThread(await buildRequest());
      }

      if (didUnmount || controller.signal.aborted) {
        outputBitmap.close();
        return;
      }

      context.clearRect(0, 0, targetWidth, targetHeight);
      context.drawImage(outputBitmap, 0, 0, targetWidth, targetHeight);
      outputBitmap.close();
      void storeDitherCanvas(ditherCacheKey, canvas).catch(() => {
        // Ignore cache write failures.
      });
    };

    const maybeStart = () => {
      if (started || didUnmount) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      started = true;
      observer.disconnect();

      void renderOnce().catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Failed to render dither image:", error);
      });
    };

    const observer = new ResizeObserver(() => {
      maybeStart();
    });

    observer.observe(container);
    maybeStart();

    return () => {
      didUnmount = true;
      controller.abort();
      observer.disconnect();
    };
  }, [
    brightness,
    contrast,
    invert,
    maxResizeHeight,
    maxResizeWidth,
    objectFit,
    processingWidth,
    src,
    threshold,
  ]);

  const rootClassName = className
    ? `absolute inset-0 h-full w-full ${className}`
    : "absolute inset-0 h-full w-full";

  return (
    <div ref={containerRef} className={rootClassName}>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ imageRendering: "pixelated" }}
        aria-label="Dithered image"
        role="img"
      />
    </div>
  );
};
