"use client";

import * as Primitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        "peer size-3.5 shrink-0 rounded-[3px] border border-border-strong bg-surface transition-colors duration-150 outline-none",
        "hover:border-brand",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <Primitive.Indicator className="flex items-center justify-center text-brand-fg">
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3.5} />
        )}
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
