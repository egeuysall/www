# Ege Site

Minimal static site (Astro + MDX) for blog, diary, and projects.

## Run

```bash
bun install
bun run dev
```

### Local `/cdn` proxy

During local development and preview, `/cdn/*` is proxied to R2.

Optional override in `.env.local`:

```bash
LOCAL_CDN_ORIGIN=https://pub-9fdddd84473b494eaa064f2306a09969.r2.dev
```

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
