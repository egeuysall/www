// Pre-build OG image generation (sharp cannot run in the Workers prerender runtime).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveContentCdnShorthand } from "../src/lib/content-cdn";
import { buildCreamCardOgImage } from "../src/lib/og-image";

const root = join(import.meta.dir, "..");

for (const collection of ["blog", "diary"] as const) {
  const dir = join(root, "src/content", collection);
  const outDir = join(root, "public/og", collection);
  await mkdir(outDir, { recursive: true });

  for (const file of await readdir(dir)) {
    if (!file.endsWith(".mdx") && !file.endsWith(".md")) continue;
    const raw = await readFile(join(dir, file), "utf8");
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    if (/^draft:\s*true/m.test(fm)) continue;
    const image = fm.match(/^image:\s*["']?(.+?)["']?\s*$/m)?.[1];
    if (!image) continue;

    const slug = file.replace(/\.mdx?$/, "");
    const png = await buildCreamCardOgImage(resolveContentCdnShorthand(image));
    await writeFile(join(outDir, `${slug}.png`), new Uint8Array(png));
    console.log(`og ${collection}/${slug}`);
  }
}
