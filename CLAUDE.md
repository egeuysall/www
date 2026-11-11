<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# www — egeuysal.com

Astro 7 + MDX + React 19 + Tailwind 4, Convex (views/likes/comments), Vercel, Cloudflare R2 CDN, Bun. Site config: `src/config/site.ts`.

## Commands
- `bun run dev` · `bun run check` (astro sync + tsc) · `bun run build` · `bun test` · `bun run check:bundle`
- Run `bun run check` before saying anything is done.

## Content (the source of truth for voice and history)
- Blog: `src/content/blog/<slug>.mdx` — frontmatter: title, description, publishedAt, tags, image
- Diary: `src/content/diary/YYYY-MM-DD.mdx` — frontmatter: date, summary, tags, optional image. Sections: IBX snapshot, What moved, Context, Takeaway
- Photo: `src/content/photo/img-N.mdx` — frontmatter: title, imageUrl, publishedAt, description, location, tags
- `src/content/diary/_runtime/` is gitignored generated data; don't commit it
- Images: use `https://cdn.egeuysal.com/...`; photos use `photo-1080/<name>.jpg` (upload via `scripts/photo-upload.sh <file> <name>`). Prefer new names over overwriting cached objects.
- Publishing is automatic on push to `master` (webhook fans out to X/LinkedIn/email for new posts). Don't edit/commit published posts casually.

## Rules
- Convex: read `convex/_generated/ai/guidelines.md` first; use the convex-* skills.
- Never expose `INTERACTION_WRITE_SECRET` or other secrets to the browser; public writes go through `/api/engagement`.
- Don't touch `.env*`, `dist/`, `.astro/`, `.vercel/`, `node_modules/`.
- UI: shadcn via CLI only; tokens in global CSS; match existing blog code-block styling.
- Match existing commit style (`fix(ai): ...`, `feat(blog): ...`).
