type DitherCacheKeyParams = {
  src: string;
  targetWidth: number;
  targetHeight: number;
  maxResizeWidth: number;
  maxResizeHeight: number;
  processingWidth: number;
  objectFit: "cover" | "contain" | "fill" | "none";
  threshold: number;
  brightness: number;
  contrast: number;
  invert: boolean;
};

type DitherCacheState = {
  blobsByKey: Map<string, Blob>;
  lruKeys: string[];
  inFlightByKey: Map<string, Promise<Blob | null>>;
};

const CACHE_STORAGE_NAME = "dither-output-cache-v1";
const CACHE_ALGORITHM_VERSION = "bayer-v1";
const MAX_MEMORY_ENTRIES = 20;
const MAX_BLOB_BYTES = 12 * 1024 * 1024;

const globalScope = globalThis as typeof globalThis & {
  __ditherOutputCacheState?: DitherCacheState;
};

const state: DitherCacheState =
  globalScope.__ditherOutputCacheState ??
  (globalScope.__ditherOutputCacheState = {
    blobsByKey: new Map(),
    lruKeys: [],
    inFlightByKey: new Map(),
  });

function touchLruKey(cacheKey: string): void {
  const index = state.lruKeys.indexOf(cacheKey);
  if (index !== -1) {
    state.lruKeys.splice(index, 1);
  }

  state.lruKeys.push(cacheKey);

  while (state.lruKeys.length > MAX_MEMORY_ENTRIES) {
    const oldest = state.lruKeys.shift();
    if (!oldest) break;
    state.blobsByKey.delete(oldest);
  }
}

function normalizeSrc(input: string): string {
  try {
    const url = new URL(input, window.location.href);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {
    // Fall through to use the raw value.
  }

  return input;
}

function stableNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toFixed(decimals);
}

// FNV-1a 64-bit hash for compact cache keys.
function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}

function toStorageUrl(cacheKey: string): string {
  const url = new URL(
    `/__dither_cache__/${CACHE_ALGORITHM_VERSION}/${hashString(cacheKey)}`,
    window.location.origin,
  );
  return url.toString();
}

async function tryReadFromCacheStorage(cacheKey: string): Promise<Blob | null> {
  if (!("caches" in window)) {
    return null;
  }

  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    const response = await cache.match(toStorageUrl(cacheKey));
    if (!response || !response.ok) {
      return null;
    }

    const storedKey = response.headers.get("x-dither-cache-key");
    if (storedKey !== cacheKey) {
      return null;
    }

    return await response.blob();
  } catch {
    return null;
  }
}

async function writeToCacheStorage(cacheKey: string, blob: Blob): Promise<void> {
  if (!("caches" in window)) {
    return;
  }

  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    const response = new Response(blob, {
      headers: {
        "content-type": blob.type || "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "x-dither-cache-key": cacheKey,
      },
    });

    await cache.put(toStorageUrl(cacheKey), response);
  } catch {
    // Ignore Cache Storage write errors (quota/private mode).
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/webp",
      0.86,
    );
  });
}

export function buildDitherCacheKey(params: DitherCacheKeyParams): string {
  const payload = [
    CACHE_ALGORITHM_VERSION,
    normalizeSrc(params.src),
    String(Math.max(1, Math.round(params.targetWidth))),
    String(Math.max(1, Math.round(params.targetHeight))),
    String(Math.max(1, Math.round(params.maxResizeWidth))),
    String(Math.max(1, Math.round(params.maxResizeHeight))),
    String(Math.max(1, Math.round(params.processingWidth))),
    params.objectFit,
    stableNumber(params.threshold),
    stableNumber(params.brightness),
    stableNumber(params.contrast),
    params.invert ? "1" : "0",
  ];

  return payload.join("|");
}

export async function getCachedDitherBitmap(cacheKey: string): Promise<ImageBitmap | null> {
  const memoryBlob = state.blobsByKey.get(cacheKey);
  if (memoryBlob) {
    touchLruKey(cacheKey);

    try {
      return await createImageBitmap(memoryBlob);
    } catch {
      state.blobsByKey.delete(cacheKey);
    }
  }

  const inFlight = state.inFlightByKey.get(cacheKey);
  if (inFlight) {
    const inFlightBlob = await inFlight;
    if (!inFlightBlob) return null;

    try {
      return await createImageBitmap(inFlightBlob);
    } catch {
      return null;
    }
  }

  const fetchPromise = tryReadFromCacheStorage(cacheKey).finally(() => {
    state.inFlightByKey.delete(cacheKey);
  });

  state.inFlightByKey.set(cacheKey, fetchPromise);

  const cachedBlob = await fetchPromise;
  if (!cachedBlob) {
    return null;
  }

  state.blobsByKey.set(cacheKey, cachedBlob);
  touchLruKey(cacheKey);

  try {
    return await createImageBitmap(cachedBlob);
  } catch {
    state.blobsByKey.delete(cacheKey);
    return null;
  }
}

export async function storeDitherCanvas(cacheKey: string, canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas);
  if (!blob || blob.size <= 0 || blob.size > MAX_BLOB_BYTES) {
    return;
  }

  state.blobsByKey.set(cacheKey, blob);
  touchLruKey(cacheKey);
  await writeToCacheStorage(cacheKey, blob);
}
