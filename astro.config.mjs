// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import {
  ALLOWED_IMAGE_HOSTS,
  ALLOWED_IMAGE_PATTERNS,
  SITE,
} from "./src/config/site";
import { handleMcpDevRequest } from "./src/mcp/dev-middleware";
import { SHIKI_THEMES } from "./src/lib/code-themes.mjs";
import remarkContentCdnShorthand from "./src/plugins/remark-content-cdn-shorthand.mjs";
import remarkInlineShiki from "./src/plugins/remark-inline-shiki.mjs";

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  adapter: vercel({
    imageService: true,
    maxDuration: 300,
    imagesConfig: { sizes: [320, 640, 720, 960, 1080, 1280] },
  }),
  integrations: [react(), mdx(), sitemap()],
  image: {
    domains: ALLOWED_IMAGE_HOSTS,
    remotePatterns: ALLOWED_IMAGE_PATTERNS,
  },
  markdown: {
    syntaxHighlight: "shiki",
    shikiConfig: {
      themes: SHIKI_THEMES,
      defaultColor: false,
    },
    processor: unified({
      remarkPlugins: [
        remarkMath,
        remarkContentCdnShorthand,
        [remarkInlineShiki, { themes: SHIKI_THEMES, defaultColor: false }],
      ],
      rehypePlugins: [rehypeKatex],
    }),
  },
  vite: {
    optimizeDeps: {
      include: ["@streamdown/math", "streamdown", "sonner", "clsx", "tailwind-merge"],
    },
    plugins: [
      tailwindcss(),
      {
        name: "www-mcp-dev-server",
        configureServer(server) {
          server.middlewares.use("/mcp", async (request, response, next) => {
            try {
              await handleMcpDevRequest(request, response);
            } catch (error) {
              next(error);
            }
          });
        },
      },
    ],
    server: {
      proxy: {
        "/cdn": {
          target: "https://cdn.egeuysal.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cdn/, ""),
        },
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
