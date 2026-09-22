"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = Primitive.Provider;
export const TooltipRoot = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-72 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs leading-relaxed text-secondary shadow-overlay",
          "data-[state=delayed-open]:animate-in-up",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

/** Shorthand for the common "wrap a trigger, show text" case. */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 200,
  className,
  asChild = true,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
  className?: string;
  asChild?: boolean;
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipRoot delayDuration={delay}>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}
