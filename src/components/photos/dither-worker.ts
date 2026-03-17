/// <reference lib="webworker" />

type ObjectFitMode = "cover" | "contain" | "fill" | "none";

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

const BAYER_MATRIX_8X8 = new Uint8Array([
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

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
  ctx: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
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
    const matrixRowOffset = (y & 7) * 8;

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

      const matrixValue = (BAYER_MATRIX_8X8[matrixRowOffset + (x & 7)] + 0.5) / 64;
      const cutoff = clamp(matrixValue + thresholdShift, 0, 1) * 255;

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

workerScope.onmessage = (event: MessageEvent<DitherRequest>) => {
  const request = event.data;

  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not supported in worker context.");
    }

    const resizedSize = fitInside(
      request.bitmap.width,
      request.bitmap.height,
      request.maxResizeWidth,
      request.maxResizeHeight,
    );

    const resizedCanvas = new OffscreenCanvas(resizedSize.width, resizedSize.height);
    const resizedCtx = resizedCanvas.getContext("2d", { willReadFrequently: true });

    if (!resizedCtx) {
      throw new Error("Failed to create resize context.");
    }

    resizedCtx.imageSmoothingEnabled = true;
    resizedCtx.imageSmoothingQuality = "high";
    resizedCtx.drawImage(request.bitmap, 0, 0, resizedSize.width, resizedSize.height);

    request.bitmap.close();

    const clampedProcessingWidth = clamp(Math.round(request.processingWidth), 256, 320);
    const processWidth = Math.max(1, Math.min(resizedSize.width, clampedProcessingWidth));
    const processHeight = Math.max(
      1,
      Math.round((resizedSize.height * processWidth) / resizedSize.width),
    );

    const processCanvas = new OffscreenCanvas(processWidth, processHeight);
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

    const outputCanvas = new OffscreenCanvas(
      request.targetWidth,
      request.targetHeight,
    );
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

    const bitmap = outputCanvas.transferToImageBitmap();
    const response: WorkerResponse = { ok: true, bitmap };
    workerScope.postMessage(response, [bitmap]);
  } catch (error) {
    try {
      request.bitmap.close();
    } catch {
      // Ignore close errors when ownership was already transferred or closed.
    }

    const response: WorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown worker error.",
    };
    workerScope.postMessage(response);
  }
};

export {};
