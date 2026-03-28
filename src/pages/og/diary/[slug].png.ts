import { getCollection } from "astro:content";

import { resolveContentCdnShorthand } from "@/lib/content-cdn";
import { getDiaryEntrySlug } from "@/lib/content";
import { buildCreamCardOgImage } from "@/lib/og-image";

export const prerender = true;

type StaticPath = {
  params: { slug: string };
  props: { imageUrl: string };
};

export async function getStaticPaths(): Promise<StaticPath[]> {
  const entries = await getCollection("diary", ({ data }) => !data.draft);

  return entries
    .filter((entry) => Boolean(entry.data.image))
    .map((entry) => ({
      params: { slug: getDiaryEntrySlug(entry) },
      props: {
        imageUrl: resolveContentCdnShorthand(entry.data.image!),
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
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
