"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverClose = Primitive.Close;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-surface-raised shadow-overlay outline-none",
          "data-[state=open]:animate-in-up",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
