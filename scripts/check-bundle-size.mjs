import fs from "node:fs";
import path from "node:path";

const DIST_ASTRO_DIR = [
  path.join(process.cwd(), "dist", "client", "_astro"),
  path.join(process.cwd(), "dist", "_astro"),
].find(fs.existsSync);
const CLIENT_DIR = path.join(process.cwd(), "dist", "client");
const BUDGET_BYTES = 1024 * 1024;

if (!DIST_ASTRO_DIR) {
  console.error("Missing built Astro assets. Run `bun run build` before checking bundle size.");
  process.exit(1);
}

const roots = new Set(
  fs.globSync("**/*.html", { cwd: CLIENT_DIR }).flatMap((file) =>
    [...fs.readFileSync(path.join(CLIENT_DIR, file), "utf8").matchAll(/\/_astro\/([\w.-]+\.js)/g)]
      .map((match) => match[1]),
  ),
);
const jsFiles = new Set();

function addStaticImports(file) {
  if (jsFiles.has(file) || !fs.existsSync(path.join(DIST_ASTRO_DIR, file))) return;
  jsFiles.add(file);
  const source = fs.readFileSync(path.join(DIST_ASTRO_DIR, file), "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g)) {
    addStaticImports(match[1]);
  }
}

roots.forEach(addStaticImports);

const totalBytes = [...jsFiles].reduce((sum, file) => {
  const stat = fs.statSync(path.join(DIST_ASTRO_DIR, file));
  return sum + stat.size;
}, 0);

const totalKb = totalBytes / 1024;
const budgetKb = BUDGET_BYTES / 1024;

if (totalBytes > BUDGET_BYTES) {
  console.error(
    `Bundle budget exceeded: ${totalKb.toFixed(2)}kb > ${budgetKb.toFixed(2)}kb`,
  );
  process.exit(1);
}

console.log(
  `Bundle budget OK: ${totalKb.toFixed(2)}kb <= ${budgetKb.toFixed(2)}kb (${jsFiles.size} initial files)`,
);
