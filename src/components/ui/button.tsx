"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-active shadow-card",
        secondary:
          "bg-surface text-primary border border-border hover:bg-surface-hover hover:border-border-strong active:bg-surface-active shadow-card",
        ghost: "text-secondary hover:bg-surface-hover hover:text-primary",
        subtle: "bg-surface-sunken text-secondary hover:bg-surface-hover hover:text-primary",
        outline:
          "border border-border-strong text-primary hover:bg-surface-hover active:bg-surface-active",
        danger: "bg-danger text-white hover:brightness-110 active:brightness-95 shadow-card",
        "danger-ghost": "text-danger-text hover:bg-danger-subtle",
        success: "bg-success text-white hover:brightness-110 active:brightness-95 shadow-card",
        ai: "border border-ai-border bg-ai-surface text-ai-accent hover:border-brand-border hover:bg-brand-subtle",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-4 text-sm",
        xl: "h-10 px-5 text-base",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        icon: "size-8",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { buttonVariants };
