import { SITE } from "@/config/site";
import {
  getDiaryDayMap,
  getDiaryEntrySlug,
  getPublishedDiaryEntries,
} from "@/lib/content";
import { resolveContentCdnShorthand } from "@/lib/content-cdn";
import { toIsoDate, toLocalIsoDate } from "@/lib/utils";

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
      url: new URL(`/diary/${slug}/`, baseUrl).toString(),
      day: dayMap.get(entry.id) ?? null,
      date: toIsoDate(entry.data.date),
      summary: entry.data.summary,
      image: entry.data.image
        ? resolveContentCdnShorthand(entry.data.image)
        : null,
      tags: entry.data.tags,
      body: entry.body,
    };
  });

  return new Response(
    JSON.stringify(
      {
        generatedAt: toLocalIsoDate(new Date()),
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
