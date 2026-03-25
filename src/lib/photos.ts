import type { CollectionEntry } from "astro:content";

import { getPhotoEntrySlug, getPublishedPhotoEntries } from "@/lib/content";

export interface PhotoAsset {
  slug: string;
  publicId: string;
  title: string;
  description: string;
  publishedAt: string;
  location?: string;
  tags: string[];
  sourceSrc: string;
  displaySrc: string;
  ditherSrc: string;
  fullSrc: string;
  alt: string;
  storyEntry: CollectionEntry<"photo">;
}

const PHOTO_PAGE_SIZE = 6;
const CDN_HOSTNAME = "cdn.egeuysal.com";

let photoFeedPromise: Promise<PhotoAsset[]> | undefined;

function getCdnProxyPath(inputUrl: string): string {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.hostname !== CDN_HOSTNAME) {
      return inputUrl;
    }

    return `/cdn${parsed.pathname}${parsed.search}`;
  } catch {
    return inputUrl;
  }
}

function getOptimizedDisplaySrc(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.hostname !== CDN_HOSTNAME) {
      return sourceUrl;
    }

    const optimizedPath = parsed.pathname.startsWith("/photo/")
      ? parsed.pathname.replace(/^\/photo\//, "/photo-1080/")
      : parsed.pathname;

    return `/cdn${optimizedPath}${parsed.search}`;
  } catch {
    return sourceUrl;
  }
}

function getOriginalPhotoSrc(inputUrl: string): string {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.hostname !== CDN_HOSTNAME) {
      return inputUrl;
    }

    const originalPath = parsed.pathname.startsWith("/photo-1080/")
      ? parsed.pathname.replace(/^\/photo-1080\//, "/photo/")
      : parsed.pathname;

    return `${parsed.origin}${originalPath}${parsed.search}`;
  } catch {
    return inputUrl;
  }
}

async function fetchPhotoPosts(): Promise<PhotoAsset[]> {
  const entries = await getPublishedPhotoEntries();

  return entries.map((entry) => {
    const slug = getPhotoEntrySlug(entry);
    const { title, description, publishedAt, location, tags, imageUrl } =
      entry.data;
    const originalImageUrl = getOriginalPhotoSrc(imageUrl);

    return {
      slug,
      publicId: slug,
      title,
      description: description ?? title,
      publishedAt: publishedAt.toISOString(),
      location,
      tags,
      sourceSrc: originalImageUrl,
      displaySrc: getOptimizedDisplaySrc(imageUrl),
      ditherSrc: getCdnProxyPath(imageUrl),
      fullSrc: originalImageUrl,
      alt: title,
      storyEntry: entry,
    };
  });
}

export async function getPhotoFeed(): Promise<PhotoAsset[]> {
  photoFeedPromise ??= fetchPhotoPosts();
  return photoFeedPromise;
}

export { PHOTO_PAGE_SIZE };
