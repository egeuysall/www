type BlobCacheOptions = {
  maxNetworkWidth?: number;
  signal?: AbortSignal;
};

type CacheState = {
  blobsByKey: Map<string, Blob>;
  lruKeys: string[];
  inFlightByKey: Map<string, Promise<Blob>>;
  imageOptimizerAvailable?: boolean;
};

const CACHE_STORAGE_NAME = "photo-blob-cache-v1";
const MAX_MEMORY_ENTRIES = 48;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const DEFAULT_NETWORK_WIDTH = 1350;

const globalScope = globalThis as typeof globalThis & {
  __photoBlobCacheState?: CacheState;
};

const state: CacheState =
  globalScope.__photoBlobCacheState ??
  (globalScope.__photoBlobCacheState = {
    blobsByKey: new Map(),
    lruKeys: [],
    inFlightByKey: new Map(),
  });

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(input: string): URL {
  const url = new URL(input, window.location.href);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Unsupported image URL protocol.");
  }
  return url;
}

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

function isPublicVercelBlobHost(hostname: string): boolean {
  return hostname.endsWith(".public.blob.vercel-storage.com");
}

function buildVercelImageUrl(sourceUrl: string, width: number): string {
  const proxyUrl = new URL("/_vercel/image", window.location.origin);
  proxyUrl.searchParams.set("url", sourceUrl);
  proxyUrl.searchParams.set("w", String(width));
  proxyUrl.searchParams.set("q", "70");
  return proxyUrl.toString();
}

function shouldAttemptVercelOptimizer(url: URL): boolean {
  if (!isPublicVercelBlobHost(url.hostname)) {
    return false;
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return false;
  }

  if (state.imageOptimizerAvailable === false) {
    return false;
  }

  return true;
}

function buildRequestCandidates(sourceUrl: URL, maxNetworkWidth: number): string[] {
  if (shouldAttemptVercelOptimizer(sourceUrl)) {
    return [
      buildVercelImageUrl(sourceUrl.toString(), maxNetworkWidth),
      sourceUrl.toString(),
    ];
  }

  return [sourceUrl.toString()];
}

async function tryReadFromCacheStorage(candidateUrl: string): Promise<Blob | null> {
  if (!("caches" in window)) {
    return null;
  }

  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    const cached = await cache.match(candidateUrl);

    if (!cached) {
      return null;
    }

    return await cached.blob();
  } catch {
    return null;
  }
}

async function writeToCacheStorage(candidateUrl: string, response: Response): Promise<void> {
  if (!("caches" in window)) {
    return;
  }

  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    await cache.put(candidateUrl, response.clone());
  } catch {
    // Ignore Cache Storage write errors (quota/private mode).
  }
}

async function fetchCandidateBlob(candidateUrl: string): Promise<Blob | null> {
  const cachedBlob = await tryReadFromCacheStorage(candidateUrl);
  if (cachedBlob) {
    return cachedBlob;
  }

  const response = await fetch(candidateUrl, {
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return null;
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large to process safely in the browser.");
  }

  await writeToCacheStorage(candidateUrl, response);
  return await response.blob();
}

async function resolveBlobForKey(sourceUrl: URL, cacheKey: string, maxNetworkWidth: number): Promise<Blob> {
  const candidates = buildRequestCandidates(sourceUrl, maxNetworkWidth);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const blob = await fetchCandidateBlob(candidate);
    if (!blob) {
      if (index === 0 && candidate.includes("/_vercel/image")) {
        state.imageOptimizerAvailable = false;
      }
      continue;
    }

    if (index === 0 && candidate.includes("/_vercel/image")) {
      state.imageOptimizerAvailable = true;
    }

    state.blobsByKey.set(cacheKey, blob);
    touchLruKey(cacheKey);
    return blob;
  }

  throw new Error("Failed to fetch image.");
}

async function waitAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return await promise;
  }

  if (signal.aborted) {
    throw abortError();
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function getCachedImageBlob(
  inputUrl: string,
  options: BlobCacheOptions = {},
): Promise<Blob> {
  const sourceUrl = normalizeUrl(inputUrl);
  const maxNetworkWidth = clamp(
    Math.round(options.maxNetworkWidth ?? DEFAULT_NETWORK_WIDTH),
    320,
    2048,
  );
  const cacheKey = `${sourceUrl.toString()}::w=${maxNetworkWidth}`;

  const cached = state.blobsByKey.get(cacheKey);
  if (cached) {
    touchLruKey(cacheKey);
    return cached;
  }

  const inFlight = state.inFlightByKey.get(cacheKey);
  if (inFlight) {
    return await waitAbortable(inFlight, options.signal);
  }

  const fetchPromise = resolveBlobForKey(sourceUrl, cacheKey, maxNetworkWidth)
    .finally(() => {
      state.inFlightByKey.delete(cacheKey);
    });

  state.inFlightByKey.set(cacheKey, fetchPromise);

  return await waitAbortable(fetchPromise, options.signal);
}

export async function prefetchImage(
  inputUrl: string,
  options: BlobCacheOptions = {},
): Promise<void> {
  try {
    await getCachedImageBlob(inputUrl, options);
  } catch {
    // Intentionally ignore prefetch errors.
  }
}

export async function prefetchImageSet(
  inputUrls: string[],
  options: BlobCacheOptions = {},
): Promise<void> {
  const uniqueUrls = [...new Set(inputUrls.filter(Boolean))];

  const maxParallel = 3;
  const queue = [...uniqueUrls];

  const workers = Array.from({ length: Math.min(maxParallel, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        continue;
      }

      await prefetchImage(next, options);
    }
  });

  await Promise.all(workers);
}
