import { cn } from "@/lib/utils";

export function Kbd({ className, children, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-border-subtle bg-surface-sunken px-1 font-sans text-2xs font-medium text-muted",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
