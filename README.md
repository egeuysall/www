# Ege Site

Minimal static site (Astro + MDX) for blog, diary, and projects.

## Run

```bash
bun install
bun run dev
```

### Local `/cdn` proxy

Content images are referenced directly from `https://cdn.egeuysal.com/...`.

## Build

```bash
bun run check
bun run build
```

## Content

- Blog: `src/content/blog/*.mdx`
- Diary: `src/content/diary/YYYY-MM-DD.mdx`

## Production

Set `PUBLIC_SITE_URL` in Vercel (or your host), for example:

```bash
PUBLIC_SITE_URL=https://egeuysal.com
```

This is used for canonical URLs, OG/Twitter URLs, RSS, robots, sitemap, and JSON-LD.
