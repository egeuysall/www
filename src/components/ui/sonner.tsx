import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import "sonner/dist/styles.css";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        className: "rounded-sm! border shadow-none!",
      }}
      style={
        {
          "--normal-bg": "var(--code-block-bg)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--code-block-border)",
          "--border-radius": "0.125rem",
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
