import { SITE } from "@/config/site";
import { getPhotoFeed } from "@/lib/photos";

type GetContext = {
  site: URL | undefined;
};

export async function GET({ site }: GetContext): Promise<Response> {
  const photos = await getPhotoFeed();
  const baseUrl = site ?? new URL(SITE.url);

  const items = photos.map((photo) => ({
    id: photo.publicId,
    slug: photo.slug,
    url: new URL(`/photo/${photo.slug}/`, baseUrl).toString(),
    title: photo.title,
    description: photo.description,
    publishedAt: photo.publishedAt,
    location: photo.location,
    tags: photo.tags,
    image: photo.displaySrc,
    fullImage: photo.fullSrc,
    body: photo.storyEntry.body,
  }));

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
