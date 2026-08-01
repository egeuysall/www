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

## Engagement and editor

Convex stores post views, likes, comments, reports, blocks, and comment images. Public writes go through `/api/engagement`; the browser never receives the Convex write secret.

Set the same write secret on the production Convex deployment before the first push:

```bash
bunx convex env set --prod INTERACTION_WRITE_SECRET <secret>
bunx convex deployment token create vercel-production --prod
```

Store the returned deploy key as `CONVEX_DEPLOY_KEY` in Vercel production. Preview deployments need a separate preview-scoped key.

The private `/editor/` route edits blog MDX and commits it to `master`, which triggers the normal Git-based Vercel deployment. Retrieve the local admin password from Keychain with:

```bash
security find-generic-password -s www-admin-password -w
```

## Production

Set these environment variables in Vercel (or your host):

```bash
PUBLIC_SITE_URL=https://egeuysal.com
CONVEX_URL=https://your-production-deployment.convex.cloud
CONVEX_DEPLOY_KEY=...
INTERACTION_WRITE_SECRET=...
INTERACTION_ACTOR_SALT=...
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=...
GITHUB_TOKEN=...
```

This is used for canonical URLs, OG/Twitter URLs, RSS, robots, sitemap, and JSON-LD.
