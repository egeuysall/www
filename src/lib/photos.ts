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

let photoFeedPromise: Promise<PhotoAsset[]> | undefined;

async function fetchPhotoPosts(): Promise<PhotoAsset[]> {
  const entries = await getPublishedPhotoEntries();

  return entries.map((entry) => {
    const slug = getPhotoEntrySlug(entry);
    const { title, description, publishedAt, location, tags, imageUrl } =
      entry.data;

    return {
      slug,
      publicId: slug,
      title,
      description: description ?? title,
      publishedAt: publishedAt.toISOString(),
      location,
      tags,
      sourceSrc: imageUrl,
      displaySrc: imageUrl,
      ditherSrc: imageUrl,
      fullSrc: imageUrl,
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
