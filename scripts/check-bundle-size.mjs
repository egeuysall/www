import fs from "node:fs";
import path from "node:path";

const DIST_ASTRO_DIR = path.join(process.cwd(), "dist", "_astro");
const BUDGET_BYTES = 100 * 1024;

if (!fs.existsSync(DIST_ASTRO_DIR)) {
  console.error("Missing dist/_astro. Run `bun run build` before checking bundle size.");
  process.exit(1);
}

const jsFiles = fs
  .readdirSync(DIST_ASTRO_DIR)
  .filter((file) => file.endsWith(".js"));

const totalBytes = jsFiles.reduce((sum, file) => {
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
  `Bundle budget OK: ${totalKb.toFixed(2)}kb <= ${budgetKb.toFixed(2)}kb (${jsFiles.length} files)`,
);
