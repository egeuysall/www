import { SITE } from "@/config/site";
import {
  getDiaryDayMap,
  getDiaryEntrySlug,
  getPublishedDiaryEntries,
} from "@/lib/content";

type GetContext = {
  site: URL | undefined;
};

export async function GET({ site }: GetContext): Promise<Response> {
  const [entries, dayMap] = await Promise.all([
    getPublishedDiaryEntries(),
    getDiaryDayMap(),
  ]);

  const baseUrl = site ?? new URL(SITE.url);
  const items = entries.map((entry) => {
    const slug = getDiaryEntrySlug(entry);

    return {
      id: entry.id,
      slug,
      url: new URL(`/diary/${slug}/`, baseUrl).toString(),
      day: dayMap.get(entry.id) ?? null,
      date: entry.data.date.toISOString(),
      summary: entry.data.summary,
      tags: entry.data.tags,
      body: entry.body,
    };
  });

  return new Response(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: items.length,
        items,
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
