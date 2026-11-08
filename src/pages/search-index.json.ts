import {
  getDiaryEntrySlug,
  getPublishedBlogPosts,
  getPublishedDiaryEntries,
} from "@/lib/content";
import { toIsoDate } from "@/lib/utils";

const stripMarkup = (value: string): string =>
  value
    .replace(/^(import|export) .*$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`~[\]()!|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function GET(): Promise<Response> {
  const [posts, entries] = await Promise.all([
    getPublishedBlogPosts(),
    getPublishedDiaryEntries(),
  ]);

  const items = [
    ...posts.map((post) => ({
      kind: "blog" as const,
      url: `/blog/${post.id}/`,
      title: post.data.title,
      description: post.data.description,
      date: toIsoDate(post.data.publishedAt),
      tags: post.data.tags ?? [],
      text: stripMarkup(post.body ?? ""),
    })),
    ...entries.map((entry) => ({
      kind: "diary" as const,
      url: `/diary/${getDiaryEntrySlug(entry)}/`,
      title: toIsoDate(entry.data.date),
      description: entry.data.summary ?? "",
      date: toIsoDate(entry.data.date),
      tags: entry.data.tags ?? [],
      text: stripMarkup(entry.body ?? ""),
    })),
  ];

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
