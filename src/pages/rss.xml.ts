import rss from "@astrojs/rss";

import { getPublishedBlogPosts } from "@/lib/content";
import { SITE } from "@/config/site";

export async function GET(context: { site: URL | undefined }) {
  const posts = await getPublishedBlogPosts();

  return rss({
    title: `${SITE.title} blog`,
    description: SITE.description,
    site: context.site ?? new URL(SITE.url),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/blog/${post.id}/`,
    })),
    customData: `<language>${SITE.locale}</language>`,
  });
}
