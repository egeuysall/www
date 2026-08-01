function titleFromPost(content: string) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const rawTitle = frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "";

  return rawTitle.replace(/^(["'])(.*)\1$/, "$2");
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
