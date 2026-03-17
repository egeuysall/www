"use client";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

type DitheringMode = "bayer" | "halftone" | "noise" | "crosshatch";
type ColorMode = "original" | "grayscale" | "duotone" | "custom";

interface DitherShaderProps {
  /** Source image URL */
  src: string;
  /** Size of the dithering grid cells */
  gridSize?: number;
  /** Type of dithering pattern */
  ditherMode?: DitheringMode;
  /** Color processing mode */
  colorMode?: ColorMode;
  /** Invert the dithered output colors */
  invert?: boolean;
  /** Pixelation multiplier (1 = no pixelation, higher = more pixelated) */
  pixelRatio?: number;
  /** Primary color for duotone mode */
  primaryColor?: string;
  /** Secondary color for duotone mode */
  secondaryColor?: string;
  /** Custom color palette array for custom mode */
  customPalette?: string[];
  /** Brightness adjustment (-1 to 1) */
  brightness?: number;
  /** Contrast adjustment (0 to 2, 1 = normal) */
  contrast?: number;
  /** Background color behind the dithered image */
  backgroundColor?: string;
  /** Object fit behavior */
  objectFit?: "cover" | "contain" | "fill" | "none";
  /** Threshold bias for dithering (0 to 1) */
  threshold?: number;
  /** Enable animation effect */
  animated?: boolean;
  /** Animation speed (lower = slower) */
  animationSpeed?: number;
  /** Additional CSS classes for the container (use this to set size via Tailwind) */
  className?: string;
}

interface LoopCache {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  effectivePixelSize: number;
  gridSize: number;
  matrixSize: number;
  xStarts: Int32Array;
  xEnds: Int32Array;
  srcXs: Int32Array;
  matrixXs: Int32Array;
  yStarts: Int32Array;
  yEnds: Int32Array;
  srcYs: Int32Array;
  matrixYs: Int32Array;
}

const BAYER_MATRIX_4x4 = new Float32Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const BAYER_MATRIX_8x8 = new Float32Array([
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

const IS_LITTLE_ENDIAN = (() => {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = 0x0a0b0c0d;
  return new Uint8Array(buffer)[0] === 0x0d;
})();

const COLOR_CACHE = new Map<string, [number, number, number]>();
let colorParserCtx: CanvasRenderingContext2D | null = null;

function getColorParserContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (!colorParserCtx) {
    const parserCanvas = document.createElement("canvas");
    parserCanvas.width = 1;
    parserCanvas.height = 1;
    colorParserCtx = parserCanvas.getContext("2d");
  }

  return colorParserCtx;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp255(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function parseColor(color: string): [number, number, number] {
  const key = color.trim().toLowerCase();
  const cached = COLOR_CACHE.get(key);
  if (cached) {
    return cached;
  }

  let result: [number, number, number] = [0, 0, 0];

  if (key.startsWith("#")) {
    const hex = key.slice(1);
    if (hex.length === 3) {
      result = [
        Number.parseInt(hex[0] + hex[0], 16),
        Number.parseInt(hex[1] + hex[1], 16),
        Number.parseInt(hex[2] + hex[2], 16),
      ];
    } else if (hex.length >= 6) {
      result = [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
  } else {
    const rgbMatch = key.match(/rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/i);
    if (rgbMatch) {
      result = [
        Number.parseInt(rgbMatch[1], 10),
        Number.parseInt(rgbMatch[2], 10),
        Number.parseInt(rgbMatch[3], 10),
      ];
    } else {
      const parser = getColorParserContext();
      if (parser) {
        parser.fillStyle = "#000";
        parser.fillStyle = key;
        const normalized = parser.fillStyle;
        const normalizedMatch = normalized.match(
          /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
        );

        if (normalizedMatch) {
          result = [
            Number.parseInt(normalizedMatch[1], 10),
            Number.parseInt(normalizedMatch[2], 10),
            Number.parseInt(normalizedMatch[3], 10),
          ];
        } else if (normalized.startsWith("#")) {
          const n = normalized.slice(1);
          if (n.length === 3) {
            result = [
              Number.parseInt(n[0] + n[0], 16),
              Number.parseInt(n[1] + n[1], 16),
              Number.parseInt(n[2] + n[2], 16),
            ];
          } else if (n.length >= 6) {
            result = [
              Number.parseInt(n.slice(0, 2), 16),
              Number.parseInt(n.slice(2, 4), 16),
              Number.parseInt(n.slice(4, 6), 16),
            ];
          }
        }
      }
    }
  }

  COLOR_CACHE.set(key, result);
  return result;
}

function packColor32(r: number, g: number, b: number, a: number): number {
  if (IS_LITTLE_ENDIAN) {
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function getLuminance01(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function buildLoopCache(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  effectivePixelSize: number,
  gridSize: number,
  matrixSize: number,
): LoopCache {
  const xBlockCount = Math.ceil(width / effectivePixelSize);
  const yBlockCount = Math.ceil(height / effectivePixelSize);

  const xStarts = new Int32Array(xBlockCount);
  const xEnds = new Int32Array(xBlockCount);
  const srcXs = new Int32Array(xBlockCount);
  const matrixXs = new Int32Array(xBlockCount);

  const yStarts = new Int32Array(yBlockCount);
  const yEnds = new Int32Array(yBlockCount);
  const srcYs = new Int32Array(yBlockCount);
  const matrixYs = new Int32Array(yBlockCount);

  for (let i = 0; i < xBlockCount; i += 1) {
    const x = i * effectivePixelSize;
    xStarts[i] = x;
    xEnds[i] = Math.min(x + effectivePixelSize, width);
    srcXs[i] = Math.floor((x * sourceWidth) / width);
    matrixXs[i] = Math.floor(x / gridSize) % matrixSize;
  }

  for (let i = 0; i < yBlockCount; i += 1) {
    const y = i * effectivePixelSize;
    yStarts[i] = y;
    yEnds[i] = Math.min(y + effectivePixelSize, height);
    srcYs[i] = Math.floor((y * sourceHeight) / height);
    matrixYs[i] = Math.floor(y / gridSize) % matrixSize;
  }

  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    effectivePixelSize,
    gridSize,
    matrixSize,
    xStarts,
    xEnds,
    srcXs,
    matrixXs,
    yStarts,
    yEnds,
    srcYs,
    matrixYs,
  };
}

export const DitherShader: React.FC<DitherShaderProps> = ({
  src,
  gridSize = 4,
  ditherMode = "bayer",
  colorMode = "original",
  invert = false,
  pixelRatio = 1,
  primaryColor = "#000000",
  secondaryColor = "#ffffff",
  customPalette = ["#000000", "#ffffff"],
  brightness = 0,
  contrast = 1,
  backgroundColor = "transparent",
  objectFit = "cover",
  threshold = 0.5,
  animated = false,
  animationSpeed = 0.02,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const sourceImageDataRef = useRef<ImageData | null>(null);

  const outputImageDataRef = useRef<ImageData | null>(null);
  const outputBuffer32Ref = useRef<Uint32Array | null>(null);

  const loopCacheRef = useRef<LoopCache | null>(null);
  const rafRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);

  const sizeRef = useRef({
    cssWidth: 0,
    cssHeight: 0,
    renderWidth: 0,
    renderHeight: 0,
    dpr: 1,
  });

  // Memoize expensive color parsing and palette derivation.
  const parsedPrimaryColor = useMemo(
    () => parseColor(primaryColor),
    [primaryColor],
  );
  const parsedSecondaryColor = useMemo(
    () => parseColor(secondaryColor),
    [secondaryColor],
  );
  const customPaletteKey = useMemo(() => customPalette.join("|"), [customPalette]);
  const parsedCustomPalette = useMemo(
    () => customPalette.map((value) => parseColor(value)),
    [customPaletteKey],
  );
  const parsedBackgroundColor = useMemo(
    () => (backgroundColor === "transparent" ? null : parseColor(backgroundColor)),
    [backgroundColor],
  );

  const matrixConfig = useMemo(
    () =>
      gridSize <= 4
        ? { matrix: BAYER_MATRIX_4x4, matrixSize: 4, matrixScaleInv: 1 / 16 }
        : { matrix: BAYER_MATRIX_8x8, matrixSize: 8, matrixScaleInv: 1 / 64 },
    [gridSize],
  );

  const renderConfig = useMemo(() => {
    const effectivePixelSize = Math.max(1, Math.floor(gridSize * pixelRatio));
    const thresholdScale = 1 - threshold;
    const thresholdOffset = threshold * 0.5;
    const levelStep = 255 / 4;
    const halftoneScaleInv = 1 / (gridSize * 2);

    // Fixed trig constants for 45deg halftone rotation.
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;

    return {
      effectivePixelSize,
      thresholdScale,
      thresholdOffset,
      brightnessOffset: brightness * 255,
      levelStep,
      halftoneScaleInv,
      cos45,
      sin45,
      matrix: matrixConfig.matrix,
      matrixSize: matrixConfig.matrixSize,
      matrixScaleInv: matrixConfig.matrixScaleInv,
      bgTransparent: parsedBackgroundColor === null,
      bgColor: parsedBackgroundColor,
    };
  }, [
    brightness,
    gridSize,
    matrixConfig.matrix,
    matrixConfig.matrixScaleInv,
    matrixConfig.matrixSize,
    parsedBackgroundColor,
    pixelRatio,
    threshold,
  ]);

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const updateCanvasMetrics = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return false;

    const rect = container.getBoundingClientRect();
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);

    if (cssWidth <= 0 || cssHeight <= 0) {
      return false;
    }

    const dpr =
      typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;

    const renderWidth = Math.max(1, Math.round(cssWidth * dpr));
    const renderHeight = Math.max(1, Math.round(cssHeight * dpr));

    const previous = sizeRef.current;
    const changed =
      previous.cssWidth !== cssWidth ||
      previous.cssHeight !== cssHeight ||
      previous.renderWidth !== renderWidth ||
      previous.renderHeight !== renderHeight ||
      previous.dpr !== dpr;

    if (!changed) {
      return false;
    }

    sizeRef.current = {
      cssWidth,
      cssHeight,
      renderWidth,
      renderHeight,
      dpr,
    };

    canvas.width = renderWidth;
    canvas.height = renderHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    ctx.imageSmoothingEnabled = false;
    ctxRef.current = ctx;

    // Dimensions changed -> invalidate reusable render buffers.
    outputImageDataRef.current = null;
    outputBuffer32Ref.current = null;
    loopCacheRef.current = null;

    return true;
  }, []);

  const rebuildSourceImageData = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;

    const hasSize = updateCanvasMetrics();
    const { renderWidth, renderHeight } = sizeRef.current;
    if (!hasSize && (renderWidth <= 0 || renderHeight <= 0)) {
      return;
    }

    let offscreen = offscreenCanvasRef.current;
    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offscreenCanvasRef.current = offscreen;
    }

    let offCtx = offscreenCtxRef.current;
    if (!offCtx) {
      offCtx = offscreen.getContext("2d", { willReadFrequently: true });
      offscreenCtxRef.current = offCtx;
    }

    if (!offCtx) return;

    offscreen.width = renderWidth;
    offscreen.height = renderHeight;

    const iw = img.naturalWidth || renderWidth;
    const ih = img.naturalHeight || renderHeight;

    let drawWidth = renderWidth;
    let drawHeight = renderHeight;
    let dx = 0;
    let dy = 0;

    if (objectFit === "cover") {
      const scale = Math.max(renderWidth / iw, renderHeight / ih);
      drawWidth = Math.ceil(iw * scale);
      drawHeight = Math.ceil(ih * scale);
      dx = Math.floor((renderWidth - drawWidth) / 2);
      dy = Math.floor((renderHeight - drawHeight) / 2);
    } else if (objectFit === "contain") {
      const scale = Math.min(renderWidth / iw, renderHeight / ih);
      drawWidth = Math.ceil(iw * scale);
      drawHeight = Math.ceil(ih * scale);
      dx = Math.floor((renderWidth - drawWidth) / 2);
      dy = Math.floor((renderHeight - drawHeight) / 2);
    } else if (objectFit === "fill") {
      drawWidth = renderWidth;
      drawHeight = renderHeight;
      dx = 0;
      dy = 0;
    } else {
      drawWidth = iw;
      drawHeight = ih;
      dx = Math.floor((renderWidth - drawWidth) / 2);
      dy = Math.floor((renderHeight - drawHeight) / 2);
    }

    offCtx.clearRect(0, 0, renderWidth, renderHeight);
    offCtx.drawImage(img, dx, dy, drawWidth, drawHeight);

    try {
      sourceImageDataRef.current = offCtx.getImageData(0, 0, renderWidth, renderHeight);
      outputImageDataRef.current = null;
      outputBuffer32Ref.current = null;
      loopCacheRef.current = null;
    } catch {
      console.error("Could not get image data. CORS issue?");
    }
  }, [objectFit, updateCanvasMetrics]);

  const renderFrame = useCallback(
    (time: number) => {
      const ctx = ctxRef.current;
      const sourceImage = sourceImageDataRef.current;
      if (!ctx || !sourceImage) return;

      const width = sourceImage.width;
      const height = sourceImage.height;

      let outputImage = outputImageDataRef.current;
      if (!outputImage || outputImage.width !== width || outputImage.height !== height) {
        outputImage = new ImageData(width, height);
        outputImageDataRef.current = outputImage;
        outputBuffer32Ref.current = IS_LITTLE_ENDIAN
          ? new Uint32Array(outputImage.data.buffer)
          : null;
      }

      let loopCache = loopCacheRef.current;
      if (
        !loopCache ||
        loopCache.width !== width ||
        loopCache.height !== height ||
        loopCache.sourceWidth !== sourceImage.width ||
        loopCache.sourceHeight !== sourceImage.height ||
        loopCache.effectivePixelSize !== renderConfig.effectivePixelSize ||
        loopCache.gridSize !== gridSize ||
        loopCache.matrixSize !== renderConfig.matrixSize
      ) {
        loopCache = buildLoopCache(
          width,
          height,
          sourceImage.width,
          sourceImage.height,
          renderConfig.effectivePixelSize,
          gridSize,
          renderConfig.matrixSize,
        );
        loopCacheRef.current = loopCache;
      }

      const sourceData = sourceImage.data;
      const outputData = outputImage.data;
      const output32 = outputBuffer32Ref.current;

      if (renderConfig.bgTransparent) {
        if (output32) {
          output32.fill(0);
        } else {
          outputData.fill(0);
        }
      } else {
        const [br, bg, bb] = renderConfig.bgColor ?? [0, 0, 0];

        if (output32) {
          output32.fill(packColor32(br, bg, bb, 255));
        } else {
          for (let i = 0; i < outputData.length; i += 4) {
            outputData[i] = br;
            outputData[i + 1] = bg;
            outputData[i + 2] = bb;
            outputData[i + 3] = 255;
          }
        }
      }

      const { matrix, matrixScaleInv, thresholdOffset, thresholdScale } = renderConfig;
      const matrixSize = renderConfig.matrixSize;
      const xCount = loopCache.xStarts.length;
      const yCount = loopCache.yStarts.length;
      const levelStep = renderConfig.levelStep;

      const customPaletteLength = parsedCustomPalette.length;
      const customPaletteLastIndex = Math.max(customPaletteLength - 1, 0);

      for (let yi = 0; yi < yCount; yi += 1) {
        const yStart = loopCache.yStarts[yi];
        const yEnd = loopCache.yEnds[yi];
        const srcY = loopCache.srcYs[yi];
        const matrixY = loopCache.matrixYs[yi];
        const srcRowOffset = srcY * sourceImage.width;

        for (let xi = 0; xi < xCount; xi += 1) {
          const xStart = loopCache.xStarts[xi];
          const xEnd = loopCache.xEnds[xi];
          const srcX = loopCache.srcXs[xi];
          const matrixX = loopCache.matrixXs[xi];

          const srcIdx = (srcRowOffset + srcX) * 4;
          const alpha = sourceData[srcIdx + 3] ?? 0;

          // Preserve previous behavior: transparent source blocks remain unpainted.
          if (alpha < 10) continue;

          let r = sourceData[srcIdx] ?? 0;
          let g = sourceData[srcIdx + 1] ?? 0;
          let b = sourceData[srcIdx + 2] ?? 0;

          r = clamp255((r - 128) * contrast + 128 + renderConfig.brightnessOffset);
          g = clamp255((g - 128) * contrast + 128 + renderConfig.brightnessOffset);
          b = clamp255((b - 128) * contrast + 128 + renderConfig.brightnessOffset);

          const luminance = getLuminance01(r, g, b);

          let ditherThreshold = 0;

          switch (ditherMode) {
            case "bayer": {
              ditherThreshold = matrix[matrixY * matrixSize + matrixX] * matrixScaleInv;
              break;
            }
            case "halftone": {
              const rotX =
                xStart * renderConfig.cos45 + yStart * renderConfig.sin45;
              const rotY =
                -xStart * renderConfig.sin45 + yStart * renderConfig.cos45;
              const pattern =
                (Math.sin(rotX * renderConfig.halftoneScaleInv) +
                  Math.sin(rotY * renderConfig.halftoneScaleInv) +
                  2) /
                4;
              ditherThreshold = pattern;
              break;
            }
            case "noise": {
              const noiseValue =
                Math.sin(xStart * 12.9898 + yStart * 78.233 + time * 100) *
                43758.5453;
              ditherThreshold = noiseValue - Math.floor(noiseValue);
              break;
            }
            case "crosshatch": {
              const crossSpan = gridSize * 2;
              const line1 = (xStart + yStart) % crossSpan < gridSize ? 1 : 0;
              const line2 =
                (xStart - yStart + gridSize * 4) % crossSpan < gridSize ? 1 : 0;
              ditherThreshold = (line1 + line2) * 0.5;
              break;
            }
            default: {
              ditherThreshold = matrix[matrixY * matrixSize + matrixX] * matrixScaleInv;
              break;
            }
          }

          ditherThreshold = ditherThreshold * thresholdScale + thresholdOffset;

          let outR = 0;
          let outG = 0;
          let outB = 0;

          switch (colorMode) {
            case "grayscale": {
              const dark = luminance < ditherThreshold;
              outR = dark ? 0 : 255;
              outG = dark ? 0 : 255;
              outB = dark ? 0 : 255;
              break;
            }
            case "duotone": {
              const dark = luminance < ditherThreshold;
              const color = dark ? parsedPrimaryColor : parsedSecondaryColor;
              outR = color[0];
              outG = color[1];
              outB = color[2];
              break;
            }
            case "custom": {
              if (customPaletteLength === 2) {
                const dark = luminance < ditherThreshold;
                const color = dark ? parsedCustomPalette[0] : parsedCustomPalette[1];
                outR = color[0];
                outG = color[1];
                outB = color[2];
              } else if (customPaletteLength > 0) {
                const adjustedLuminance = luminance + (ditherThreshold - 0.5) * 0.5;
                const paletteIndex = Math.floor(
                  clamp(adjustedLuminance, 0, 1) * customPaletteLastIndex,
                );
                const color = parsedCustomPalette[paletteIndex] ?? parsedCustomPalette[0];
                outR = color[0];
                outG = color[1];
                outB = color[2];
              }
              break;
            }
            case "original":
            default: {
              const ditherAmount = ditherThreshold - 0.5;
              const adjustedR = clamp255(r + ditherAmount * 64);
              const adjustedG = clamp255(g + ditherAmount * 64);
              const adjustedB = clamp255(b + ditherAmount * 64);

              outR = Math.round(Math.round(adjustedR / levelStep) * levelStep);
              outG = Math.round(Math.round(adjustedG / levelStep) * levelStep);
              outB = Math.round(Math.round(adjustedB / levelStep) * levelStep);
              break;
            }
          }

          if (invert) {
            outR = 255 - outR;
            outG = 255 - outG;
            outB = 255 - outB;
          }

          if (output32) {
            const color32 = packColor32(outR, outG, outB, 255);

            for (let py = yStart; py < yEnd; py += 1) {
              const rowStart = py * width + xStart;
              output32.fill(color32, rowStart, rowStart + (xEnd - xStart));
            }
          } else {
            for (let py = yStart; py < yEnd; py += 1) {
              let idx = (py * width + xStart) * 4;
              for (let px = xStart; px < xEnd; px += 1) {
                outputData[idx] = outR;
                outputData[idx + 1] = outG;
                outputData[idx + 2] = outB;
                outputData[idx + 3] = 255;
                idx += 4;
              }
            }
          }
        }
      }

      // Single canvas upload per frame.
      ctx.putImageData(outputImage, 0, 0);
    },
    [
      colorMode,
      contrast,
      ditherMode,
      gridSize,
      invert,
      parsedCustomPalette,
      parsedPrimaryColor,
      parsedSecondaryColor,
      renderConfig,
    ],
  );

  // Redraw when render config / palette props change (without forcing React state updates).
  useEffect(() => {
    if (!imageRef.current) return;
    renderFrame(timeRef.current);
  }, [renderFrame]);

  // Rebuild source buffer when object-fit behavior changes.
  useEffect(() => {
    if (!imageRef.current) return;
    rebuildSourceImageData();
    renderFrame(timeRef.current);
  }, [objectFit, rebuildSourceImageData, renderFrame]);

  // Keep source + canvas buffers in sync with responsive size using refs only.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncSizeAndRender = () => {
      const changed = updateCanvasMetrics();
      if (changed) {
        rebuildSourceImageData();
      }
      renderFrame(timeRef.current);
    };

    const observer = new ResizeObserver(() => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(syncSizeAndRender);
    });

    observer.observe(container);
    syncSizeAndRender();

    return () => {
      observer.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [rebuildSourceImageData, renderFrame, updateCanvasMetrics]);

  // Reuse one HTMLImageElement per src change and rebuild source data once loaded.
  useEffect(() => {
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    const handleLoad = () => {
      if (cancelled) return;
      imageRef.current = img;
      rebuildSourceImageData();
      renderFrame(timeRef.current);
    };

    img.onload = handleLoad;
    img.onerror = () => {
      if (!cancelled) {
        console.error("Failed to load image for DitherShader:", src);
      }
    };

    img.src = src;

    if (img.complete && img.naturalWidth > 0) {
      handleLoad();
    }

    return () => {
      cancelled = true;
    };
  }, [src, rebuildSourceImageData, renderFrame]);

  // Only animate when time-dependent dithering is active.
  const shouldAnimate = animated && ditherMode === "noise";

  useEffect(() => {
    stopAnimation();

    if (!shouldAnimate) {
      renderFrame(timeRef.current);
      return;
    }

    const tick = () => {
      timeRef.current += animationSpeed;
      renderFrame(timeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopAnimation();
    };
  }, [animationSpeed, renderFrame, shouldAnimate, stopAnimation]);

  useEffect(() => {
    return () => {
      stopAnimation();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, [stopAnimation]);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full", className)}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated" }}
        aria-label="Dithered image"
        role="img"
      />
    </div>
  );
};
