import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(3),
    description: z.string().min(8),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().default(false),
    image: z
      .union([
        z.url(),
        z.string().regex(/^\/cdn\/[^\s?#]+$/),
      ])
      .optional(),
  }),
});

const diary = defineCollection({
  loader: glob({ base: "./src/content/diary", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    date: z.coerce.date(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    summary: z.string().min(4),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().default(false),
  }),
});

const photo = defineCollection({
  loader: glob({ base: "./src/content/photo", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(1),
    imageUrl: z.union([
      z.url(),
      z.string().regex(/^\/cdn\/[^\s?#]+$/),
    ]),
    publishedAt: z.coerce.date(),
    description: z.string().optional(),
    location: z.string().optional(),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  blog,
  diary,
  photo,
};
