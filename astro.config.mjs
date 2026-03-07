// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

import { ALLOWED_IMAGE_HOSTS, ALLOWED_IMAGE_PATTERNS, SITE } from "./src/config/site";

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  integrations: [react(), mdx(), sitemap()],
  image: {
    domains: ALLOWED_IMAGE_HOSTS,
    remotePatterns: ALLOWED_IMAGE_PATTERNS,
  },
  markdown: {
    syntaxHighlight: "shiki",
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
