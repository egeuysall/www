import { getCollection, type CollectionEntry } from "astro:content";
import path from "node:path";

import { readingTimeMinutes } from "@/lib/utils";

function assertDiaryFilenameMatchesDate(entry: CollectionEntry<"diary">): void {
  const fileName = path.basename(entry.id).replace(/\.mdx?$/, "");
  const frontmatterDate = entry.data.date.toISOString().slice(0, 10);

  if (fileName !== frontmatterDate) {
    throw new Error(
      `Diary entry date mismatch: "${entry.id}" has date "${frontmatterDate}". Expected "${fileName}" in frontmatter.`,
    );
  }
}

function assertUniqueDiarySlugs(entries: CollectionEntry<"diary">[]): void {
  const seen = new Map<string, string>();

  for (const entry of entries) {
    const slug = getDiaryEntrySlug(entry);
    const existing = seen.get(slug);

    if (existing) {
      throw new Error(
        `Duplicate diary slug "${slug}" found in "${entry.id}" and "${existing}".`,
      );
    }

    seen.set(slug, entry.id);
  }
}

function assertUniquePhotoSlugs(entries: CollectionEntry<"photo">[]): void {
  const seen = new Map<string, string>();

  for (const entry of entries) {
    const slug = getPhotoEntrySlug(entry);
    const existing = seen.get(slug);

    if (existing) {
      throw new Error(
        `Duplicate photo slug "${slug}" found in "${entry.id}" and "${existing}".`,
      );
    }

    seen.set(slug, entry.id);
  }
}

export function getDiaryEntrySlug(entry: CollectionEntry<"diary">): string {
  return entry.data.slug ?? entry.slug;
}

export function getPhotoEntrySlug(entry: CollectionEntry<"photo">): string {
  return entry.slug;
}

export async function getPublishedBlogPosts(): Promise<
  Array<CollectionEntry<"blog"> & { readingTime: number }>
> {
  const entries = await getCollection("blog", ({ data }) => !data.draft);

  return entries
    .map((entry) => ({
      ...entry,
      readingTime: readingTimeMinutes(entry.body),
    }))
    .sort(
      (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime(),
    );
}

export async function getPublishedDiaryEntries(): Promise<
  CollectionEntry<"diary">[]
> {
  const entries = await getCollection("diary", ({ data }) => !data.draft);

  entries.forEach(assertDiaryFilenameMatchesDate);
  assertUniqueDiarySlugs(entries);

  return entries.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getPublishedPhotoEntries(): Promise<
  CollectionEntry<"photo">[]
> {
  const entries = await getCollection("photo", ({ data }) => !data.draft);

  assertUniquePhotoSlugs(entries);
  return entries.sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime(),
  );
}

export async function getDiaryDayMap(): Promise<Map<string, number>> {
  const entries = await getCollection("diary", ({ data }) => !data.draft);

  entries.forEach(assertDiaryFilenameMatchesDate);
  assertUniqueDiarySlugs(entries);

  const asc = entries.sort(
    (a, b) => a.data.date.getTime() - b.data.date.getTime(),
  );

  const map = new Map<string, number>();

  asc.forEach((entry, index) => {
    map.set(entry.id, index + 1);
  });

  return map;
}
