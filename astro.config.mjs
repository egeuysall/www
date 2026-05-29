// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

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
  adapter: vercel(),
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
    remarkPlugins: [
      remarkContentCdnShorthand,
      [remarkInlineShiki, { themes: SHIKI_THEMES, defaultColor: false }],
    ],
  },
  vite: {
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
