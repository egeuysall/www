const CONTENT_CDN_BASE_URL = "https://cdn.egeuysal.com/content/";
const HAS_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function stripLeadingContentPath(value) {
  return value.replace(/^content\/+/, "");
}

function normalizeContentCdnUrl(input) {
  const value = String(input ?? "").trim();

  if (!value) {
    return value;
  }

  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("//") ||
    HAS_PROTOCOL.test(value)
  ) {
    return value;
  }

  return new URL(stripLeadingContentPath(value), CONTENT_CDN_BASE_URL).toString();
}

function isBlogOrDiaryContentFile(filePath) {
  if (!filePath) {
    return false;
  }

  const normalizedPath = filePath.replaceAll("\\", "/");
  return (
    normalizedPath.includes("/src/content/blog/") ||
    normalizedPath.includes("/src/content/diary/")
  );
}

function walk(tree, visitor) {
  const stack = [tree];

  while (stack.length > 0) {
    const node = stack.pop();
    visitor(node);

    if (!node || !Array.isArray(node.children)) {
      continue;
    }

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
}

export default function remarkContentCdnShorthand() {
  return function transformer(tree, file) {
    if (!isBlogOrDiaryContentFile(file?.path)) {
      return;
    }

    walk(tree, (node) => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (node.type === "image" && typeof node.url === "string") {
        node.url = normalizeContentCdnUrl(node.url);
        return;
      }

      if (
        (node.type === "mdxJsxFlowElement" ||
          node.type === "mdxJsxTextElement") &&
        typeof node.name === "string" &&
        node.name.toLowerCase() === "img" &&
        Array.isArray(node.attributes)
      ) {
        for (const attribute of node.attributes) {
          if (
            attribute &&
            attribute.type === "mdxJsxAttribute" &&
            attribute.name === "src" &&
            typeof attribute.value === "string"
          ) {
            attribute.value = normalizeContentCdnUrl(attribute.value);
          }
        }
      }
    });
  };
}
