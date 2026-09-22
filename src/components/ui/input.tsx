import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-primary shadow-card transition-colors duration-150",
        "placeholder:text-muted",
        "hover:border-border-strong",
        "focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/25",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        "file:mr-2 file:border-0 file:bg-transparent file:text-xs file:font-medium",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-primary shadow-card transition-colors duration-150",
        "placeholder:text-muted",
        "hover:border-border-strong",
        "focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/25",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  );
}
