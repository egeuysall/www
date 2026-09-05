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

### Automatic publication

The existing iA Writer Micropub endpoint remains the site publisher and keeps its original response contract. New Micropub commits are fanned out asynchronously by the GitHub webhook at `https://egeuysal.com/api/github-webhook`; the private editor publishes directly after writing GitHub. Both paths send new posts to configured X, LinkedIn, email, and Substack handoff channels. Editing an existing post does not repost it.

Set these additional Vercel environment variables to enable distribution:

```bash
X_ACCESS_TOKEN=          # X user OAuth token with tweet.write
LINKEDIN_ACCESS_TOKEN=   # LinkedIn OAuth token with w_member_social
LINKEDIN_AUTHOR_URN=urn:li:person:<your-member-id>
LINKEDIN_API_VERSION=202603
RESEND_API_KEY=
NEWSLETTER_FROM=Ege Uysal <hi@egeuysal.com>
NEWSLETTER_TOKEN_SECRET=
GITHUB_WEBHOOK_SECRET=
SUBSTACK_AUTOMATION_WEBHOOK_URL=
SUBSTACK_AUTOMATION_WEBHOOK_TOKEN=
```

One-time setup:

1. In the [X Developer Portal](https://developer.x.com/en/portal/dashboard), create an app, enable OAuth 2.0 with `tweet.write`, and put the resulting user access token in `X_ACCESS_TOKEN`. This is a user token, not the app-only bearer token.
2. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps), create/select an app with the Share on LinkedIn product, authorize `w_member_social`, and set the returned member token and `urn:li:person:<member-id>`.
3. Verify `egeuysal.com` in Resend, create an API key, set `RESEND_API_KEY` and `NEWSLETTER_FROM`, then generate `NEWSLETTER_TOKEN_SECRET` with `openssl rand -hex 32`.
4. Add a repository push webhook to `https://egeuysal.com/api/github-webhook` with the same random value in `GITHUB_WEBHOOK_SECRET`; subscribe to the `push` event and send JSON.
5. Substack does not currently document a public article/Note publishing endpoint. For automatic handoff, point `SUBSTACK_AUTOMATION_WEBHOOK_URL` at a trusted HTTPS automation bridge that you control; otherwise use the site's RSS feed at `/rss.xml` and publish in Substack's editor.

The newsletter uses double opt-in and one-click unsubscribe. Readers do not need passwords or accounts; likes and comments continue using the existing anonymous, rate-limited flow.

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
