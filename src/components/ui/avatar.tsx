"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";
import { initials as toInitials } from "@/lib/utils";

const sizes = {
  xs: "size-5 text-2xs",
  sm: "size-6 text-2xs",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-14 text-base",
  "2xl": "size-20 text-xl",
} as const;

/**
 * Deterministic tint per person so the same face keeps the same colour across
 * screens without storing anything.
 */
function tint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const palette = [
    "bg-chart-1/15 text-chart-1",
    "bg-chart-2/15 text-chart-2",
    "bg-chart-3/15 text-chart-3",
    "bg-chart-4/15 text-chart-4",
  ];
  return palette[Math.abs(hash) % palette.length];
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
  square,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  square?: boolean;
}) {
  return (
    <Primitive.Root
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-border-subtle font-semibold select-none",
        square ? "rounded-md" : "rounded-full",
        sizes[size],
        tint(name),
        className
      )}
    >
      {src ? (
        <Primitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <Primitive.Fallback delayMs={src ? 300 : 0} className="leading-none">
        {toInitials(name) || "?"}
      </Primitive.Fallback>
    </Primitive.Root>
  );
}

/** Company logo slot — falls back to a squared initial block. */
export function CompanyAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return <Avatar name={name} src={src} size={size} square className={className} />;
}
