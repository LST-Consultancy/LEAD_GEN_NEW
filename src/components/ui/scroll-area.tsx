"use client";

import * as Primitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";

export function ScrollArea({
  className,
  children,
  viewportClassName,
  ...props
}: React.ComponentProps<typeof Primitive.Root> & { viewportClassName?: string }) {
  return (
    <Primitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <Primitive.Viewport className={cn("size-full rounded-[inherit]", viewportClassName)}>
        {children}
      </Primitive.Viewport>
      <Primitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-opacity data-[state=hidden]:opacity-0"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </Primitive.Scrollbar>
      <Primitive.Scrollbar
        orientation="horizontal"
        className="flex h-2 touch-none select-none flex-col p-0.5 transition-opacity data-[state=hidden]:opacity-0"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </Primitive.Scrollbar>
      <Primitive.Corner />
    </Primitive.Root>
  );
}
