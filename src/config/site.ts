export type SocialLink = {
  label: string;
  href: string;
};

export type ProjectProofItem = {
  title: string;
  summary: string;
  url: string;
  linkLabel?: string;
  imageUrl?: string;
  imageAlt?: string;
};

export const SITE = {
  title: "Ege Uysal",
  description:
    "Founder shipping web products. Blog, projects, and daily progress diary in one place.",
  url: process.env.PUBLIC_SITE_URL ?? "https://egeuysal.com",
  locale: "en-US",
  timezone: "America/Chicago",
  themeColor: "#000000",
  author: {
    name: "Ege Uysal",
    role: "Founder",
  },
};

export const SEO_DEFAULTS = {
  twitterCard: "summary_large_image",
  defaultOgImage: "/opengraph-image.png",
};

export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Blog", href: "/blog" },
  { label: "Diary", href: "/diary" },
  { label: "Photo", href: "/photo" },
] as const;

export const SOCIAL_LINKS: SocialLink[] = [
  { label: "GitHub", href: "https://github.com/egeuysall" },
  { label: "X", href: "https://x.com/egewrk" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/egeuysall" },
];

export const PROJECTS: ProjectProofItem[] = [
  {
    title: "Ryva",
    summary: "Kill your standups.",
    url: "https://ryva.dev",
    linkLabel: "ryva.dev",
  },
  {
    title: "Shipr",
    summary: "Ship Your SaaS This Weekend.",
    url: "https://shipr.egeuysal.com",
    linkLabel: "shipr.egeuysal.com",
  },
  {
    title: "Huesly",
    summary: "Generate beautiful, accessible brands in seconds.",
    url: "https://huesly.app",
    linkLabel: "huesly.app",
  },
];

export const ALLOWED_IMAGE_HOSTS = [
  "images.githubusercontent.com",
  "avatars.githubusercontent.com",
  "opengraph.githubassets.com",
  "cdn.jsdelivr.net",
  "images.pexels.com",
];

export const ALLOWED_IMAGE_PATTERNS = [
  {
    protocol: "https",
    hostname: "**.public.blob.vercel-storage.com",
  },
  {
    protocol: "https",
    hostname: "images.pexels.com",
  },
];
