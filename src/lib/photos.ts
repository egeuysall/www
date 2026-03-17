import type { CollectionEntry } from "astro:content";
import { getImage } from "astro:assets";

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

  return await Promise.all(
    entries.map(async (entry) => {
      const slug = getPhotoEntrySlug(entry);
      const { title, description, publishedAt, location, tags, imageUrl } =
        entry.data;

      const [displayImage, ditherImage, fullImage] = await Promise.all([
        getImage({
          src: imageUrl,
          width: 1080,
          height: 1350,
          format: "webp",
          quality: 72,
        }),
        getImage({
          src: imageUrl,
          width: 1080,
          height: 1350,
          format: "webp",
          quality: 68,
        }),
        getImage({
          src: imageUrl,
          width: 1800,
          inferSize: true,
          format: "webp",
          quality: 80,
        }),
      ]);

      return {
        slug,
        publicId: slug,
        title,
        description: description ?? title,
        publishedAt: publishedAt.toISOString(),
        location,
        tags,
        sourceSrc: imageUrl,
        displaySrc: displayImage.src,
        ditherSrc: ditherImage.src,
        fullSrc: fullImage.src,
        alt: title,
        storyEntry: entry,
      };
    }),
  );
}

export async function getPhotoFeed(): Promise<PhotoAsset[]> {
  photoFeedPromise ??= fetchPhotoPosts();
  return photoFeedPromise;
}

export { PHOTO_PAGE_SIZE };
