import { SITE } from "@/config/site";
import { getPublishedBlogPosts } from "@/lib/content";

type GetContext = {
  site: URL | undefined;
};

export async function GET({ site }: GetContext): Promise<Response> {
  const posts = await getPublishedBlogPosts();
  const baseUrl = site ?? new URL(SITE.url);

  const items = posts.map((post) => ({
    id: post.id,
    slug: post.slug,
    url: new URL(`/blog/${post.slug}/`, baseUrl).toString(),
    title: post.data.title,
    description: post.data.description,
    publishedAt: post.data.publishedAt.toISOString(),
    updatedAt: post.data.updatedAt?.toISOString() ?? null,
    tags: post.data.tags,
    image: post.data.image ?? null,
    readingTime: post.readingTime,
    body: post.body,
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
