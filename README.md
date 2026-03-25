# Ege Site

Minimal static site (Astro + MDX) for blog, diary, and projects.

## Run

```bash
bun install
bun run dev
```

### Local `/cdn` proxy

In development, `/cdn/*` is proxied to the R2 public origin so image paths work locally.

## Build

```bash
bun run check
bun run build
```

## Photo Upload Workflow

Photo assets are stored in two variants:

- Production/content URL (use this): `https://cdn.egeuysal.com/photo-1080/<name>.jpg`
- Archive/full-quality source: `https://cdn.egeuysal.com/photo/<name>.jpg`

Use the upload script:

```bash
scripts/photo-upload.sh /absolute/path/to/image.jpg img-31
```

This uploads:

- `r2:photos/photo/img-31.jpg` (full-quality source)
- `r2:photos/photo-1080/img-31.jpg` (production/content image, max width 1080, max height 1350)

Optional flags:

```bash
scripts/photo-upload.sh ./frame.png img-32 --quality 72 --overwrite
```

Notes:

- Content frontmatter for photos should use `https://cdn.egeuysal.com/photo-1080/<name>.jpg`.
- Keep `/photo` originals for full-quality display and future re-exports.
- If immutable caching is enabled, prefer new names over overwriting existing objects.

## Content

- Blog: `src/content/blog/*.mdx`
- Diary: `src/content/diary/YYYY-MM-DD.mdx`

## Production

Set `PUBLIC_SITE_URL` in Vercel (or your host), for example:

```bash
PUBLIC_SITE_URL=https://egeuysal.com
```

This is used for canonical URLs, OG/Twitter URLs, RSS, robots, sitemap, and JSON-LD.
