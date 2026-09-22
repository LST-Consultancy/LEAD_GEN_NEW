import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded font-medium [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-surface-sunken text-secondary border border-border-subtle",
        outline: "border border-border text-secondary",
        brand: "bg-brand-subtle text-brand-text border border-brand-border",
        solid: "bg-brand text-brand-fg",
        success: "bg-success-subtle text-success-text border border-success-border",
        warning: "bg-warning-subtle text-warning-text border border-warning-border",
        danger: "bg-danger-subtle text-danger-text border border-danger-border",
        info: "bg-info-subtle text-info-text border border-info-border",
        ai: "bg-ai-surface text-ai-accent border border-ai-border",
      },
      size: {
        sm: "h-4 px-1 text-2xs",
        md: "h-5 px-1.5 text-2xs",
        lg: "h-6 px-2 text-xs",
      },
      uppercase: { true: "uppercase tracking-wide", false: "" },
    },
    defaultVariants: { variant: "neutral", size: "md", uppercase: false },
  }
);

export function Badge({
  className,
  variant,
  size,
  uppercase,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, uppercase }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
