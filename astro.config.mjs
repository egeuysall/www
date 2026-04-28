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
import remarkContentCdnShorthand from "./src/plugins/remark-content-cdn-shorthand.mjs";
import remarkInlineShiki from "./src/plugins/remark-inline-shiki.mjs";

/** @type {import("shiki").ThemeRegistration} */
const SHIKI_LIGHT_THEME = {
  name: "ege-grayscale-light",
  type: "light",
  colors: {
    "editor.background": "#f7f7f8",
    "editor.foreground": "#1f1f1f",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#989898", fontStyle: "italic" },
    },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control"],
      settings: { foreground: "#0f0f0f", fontStyle: "bold" },
    },
    {
      scope: ["entity.name.function", "support.function", "variable.function"],
      settings: { foreground: "#1a1a1a" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#2a2a2a" },
    },
    {
      scope: ["string", "constant.other.symbol"],
      settings: { foreground: "#484848" },
    },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#6a6a6a" },
    },
    {
      scope: ["variable", "meta.definition.variable", "entity.name.variable"],
      settings: { foreground: "#242424" },
    },
    {
      scope: ["keyword.operator", "punctuation", "meta.brace"],
      settings: { foreground: "#7a7a7a" },
    },
  ],
};

/** @type {import("shiki").ThemeRegistration} */
const SHIKI_DARK_THEME = {
  name: "ege-grayscale-dark",
  type: "dark",
  colors: {
    "editor.background": "#0b0b0c",
    "editor.foreground": "#e6e6e6",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#7f7f7f", fontStyle: "italic" },
    },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control"],
      settings: { foreground: "#ffffff", fontStyle: "bold" },
    },
    {
      scope: ["entity.name.function", "support.function", "variable.function"],
      settings: { foreground: "#f0f0f0" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#dddddd" },
    },
    {
      scope: ["string", "constant.other.symbol"],
      settings: { foreground: "#c8c8c8" },
    },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#a3a3a3" },
    },
    {
      scope: ["variable", "meta.definition.variable", "entity.name.variable"],
      settings: { foreground: "#e2e2e2" },
    },
    {
      scope: ["keyword.operator", "punctuation", "meta.brace"],
      settings: { foreground: "#9a9a9a" },
    },
  ],
};

const SHIKI_THEMES = {
  light: SHIKI_LIGHT_THEME,
  dark: SHIKI_DARK_THEME,
};

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
