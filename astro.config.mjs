// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

import {
  ALLOWED_IMAGE_HOSTS,
  ALLOWED_IMAGE_PATTERNS,
  SITE,
} from "./src/config/site";
import remarkInlineShiki from "./src/plugins/remark-inline-shiki.mjs";

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
    remarkPlugins: [remarkInlineShiki],
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/cdn": {
          target: "https://pub-9fdddd84473b494eaa064f2306a09969.r2.dev",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cdn/, ""),
        },
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        react: "preact/compat",
        "react-dom/test-utils": "preact/test-utils",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      },
    },
  },
});
