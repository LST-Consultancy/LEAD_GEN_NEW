import { cn } from "@/lib/utils";

/**
 * Signalroom mark: three concentric arcs (a radar sweep) with a solid centre —
 * signal converging on a target. Original artwork, no third-party likeness.
 */
export function Brandmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-5 text-brand", className)}
    >
      <rect width="24" height="24" rx="6" className="fill-brand" />
      <circle cx="8.5" cy="15.5" r="2" className="fill-brand-fg" />
      <path
        d="M8.5 11.25a4.25 4.25 0 0 1 4.25 4.25"
        stroke="currentColor"
        className="stroke-brand-fg"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M8.5 7.5a8 8 0 0 1 8 8"
        stroke="currentColor"
        className="stroke-brand-fg"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Brandmark className="size-5" />
      <span className="text-sm font-semibold tracking-tight text-primary">Signalroom</span>
    </span>
  );
}
