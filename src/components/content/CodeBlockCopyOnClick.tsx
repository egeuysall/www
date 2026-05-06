import { useEffect } from "react";

import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

const COPY_ATTR = "data-copyable-code-block";

function getCodeBlocks(): HTMLPreElement[] {
  return Array.from(document.querySelectorAll<HTMLPreElement>("main pre")).filter(
    (pre): pre is HTMLPreElement => Boolean(pre.querySelector("code")),
  );
}

function getCodeText(pre: HTMLPreElement): string {
  const code = pre.querySelector("code");
  const text = code?.textContent ?? pre.textContent ?? "";
  return text.replace(/\s+$/, "");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function markCopyableBlocks() {
  for (const pre of getCodeBlocks()) {
    pre.setAttribute(COPY_ATTR, "true");
    pre.setAttribute("role", "button");
    pre.setAttribute("tabindex", "0");
    pre.setAttribute("title", "Click to copy");
  }
}

export default function CodeBlockCopyOnClick() {
  useEffect(() => {
    const onPageLoad = () => {
      markCopyableBlocks();
    };

    const onCopy = async (pre: HTMLPreElement) => {
      const selection = window.getSelection();
      if (selection && selection.type === "Range" && selection.toString().trim()) {
        return;
      }

      const text = getCodeText(pre);
      if (!text) {
        return;
      }

      const copied = await copyText(text);

      if (copied) {
        toast.success("Code copied to clipboard");
      } else {
        toast.error("Could not copy code");
      }
    };

    const onClick = async (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const pre = target.closest(`pre[${COPY_ATTR}="true"]`);
      if (!(pre instanceof HTMLPreElement)) {
        return;
      }

      await onCopy(pre);
    };

    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLPreElement)) {
        return;
      }

      if (target.getAttribute(COPY_ATTR) !== "true") {
        return;
      }

      event.preventDefault();
      await onCopy(target);
    };

    onPageLoad();
    document.addEventListener("astro:page-load", onPageLoad);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("astro:page-load", onPageLoad);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return <Toaster position="bottom-right" richColors />;
}
