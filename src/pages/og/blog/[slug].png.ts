import { getCollection } from "astro:content";

import { resolveContentCdnShorthand } from "@/lib/content-cdn";
import { buildCreamCardOgImage } from "@/lib/og-image";

export const prerender = true;

type StaticPath = {
  params: { slug: string };
  props: { imageUrl: string };
};

export async function getStaticPaths(): Promise<StaticPath[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft);

  return posts
    .filter((post) => Boolean(post.data.image))
    .map((post) => ({
      params: { slug: post.id },
      props: {
        imageUrl: resolveContentCdnShorthand(post.data.image!),
      },
    }));
}

type GetContext = {
  props: { imageUrl: string };
};

export async function GET({ props }: GetContext): Promise<Response> {
  const image = await buildCreamCardOgImage(props.imageUrl);

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=0, s-maxage=86400, must-revalidate",
    },
  });
}
