import { SITE } from "@/config/site";
import { getPhotoFeed } from "@/lib/photos";
import { toIsoDate, toLocalIsoDate } from "@/lib/utils";

type GetContext = {
  site: URL | undefined;
};

export async function GET({ site }: GetContext): Promise<Response> {
  const photos = await getPhotoFeed();
  const baseUrl = site ?? new URL(SITE.url);

  const items = photos.map((photo) => ({
    id: photo.publicId,
    url: new URL(`/photo/${photo.slug}/`, baseUrl).toString(),
    title: photo.title,
    description: photo.description,
    publishedAt: toIsoDate(photo.storyEntry.data.publishedAt),
    location: photo.location,
    tags: photo.tags,
    image: new URL(photo.sourceSrc, baseUrl).toString(),
    body: photo.storyEntry.body,
  }));

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
