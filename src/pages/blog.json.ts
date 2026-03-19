import { SITE } from "@/config/site";
import { getPublishedBlogPosts } from "@/lib/content";
import { toIsoDate, toLocalIsoDate } from "@/lib/utils";

type GetContext = {
  site: URL | undefined;
};

export async function GET({ site }: GetContext): Promise<Response> {
  const posts = await getPublishedBlogPosts();
  const baseUrl = site ?? new URL(SITE.url);

  const items = posts.map((post) => ({
    id: post.id,
    url: new URL(`/blog/${post.id}/`, baseUrl).toString(),
    title: post.data.title,
    description: post.data.description,
    publishedAt: toIsoDate(post.data.publishedAt),
    updatedAt: post.data.updatedAt ? toIsoDate(post.data.updatedAt) : null,
    tags: post.data.tags,
    image: post.data.image ?? null,
    readingTime: post.readingTime,
    body: post.body,
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
