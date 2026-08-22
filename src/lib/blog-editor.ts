function titleFromPost(content: string) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const rawTitle = frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "";

  return normalizeTitle(rawTitle.replace(/^(["'])(.*)\1$/, "$2"));
}

export function normalizeTitle(value: string): string {
  return value.trim().replace(/^[“‘](.*)[”’]$/, "$1").trim();
}

export function normalizeFrontmatterTitle(content: string): string {
  return content.replace(/^title:\s*(.+)$/m, (line, rawValue: string) => {
    const value = rawValue.trim();
    const unwrapped = /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
    const title = normalizeTitle(unwrapped);
    return title === unwrapped ? line : "title: " + JSON.stringify(title);
  });
}

export function slugFromPost(content: string) {
  const title = titleFromPost(content);

  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

export function validFrontmatter(content: string): boolean {
  if (!content.startsWith("---\n")) return false;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return false;
  const frontmatter = content.slice(4, end);
  return /^title:\s*.+$/m.test(frontmatter) && /^description:\s*.+$/m.test(frontmatter) && /^publishedAt:\s*\d{4}-\d{2}-\d{2}/m.test(frontmatter);
}
