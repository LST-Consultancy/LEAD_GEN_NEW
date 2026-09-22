"use client";

import * as Primitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        "peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "data-[state=checked]:bg-brand data-[state=unchecked]:bg-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <Primitive.Thumb
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-white shadow-card transition-transform duration-150 ease-out",
          "data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[2px]"
        )}
      />
    </Primitive.Root>
  );
}
