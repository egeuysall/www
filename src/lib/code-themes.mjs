/** @type {import("shiki").ThemeRegistration} */
export const SHIKI_LIGHT_THEME = {
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
export const SHIKI_DARK_THEME = {
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

export const SHIKI_THEMES = {
  light: SHIKI_LIGHT_THEME,
  dark: SHIKI_DARK_THEME,
};

/** @type {[import("shiki").ThemeRegistration, import("shiki").ThemeRegistration]} */
export const SHIKI_STREAMDOWN_THEMES = [
  SHIKI_LIGHT_THEME,
  SHIKI_DARK_THEME,
];
