import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12 2a10 10 0 1 0 10 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Spinner };
