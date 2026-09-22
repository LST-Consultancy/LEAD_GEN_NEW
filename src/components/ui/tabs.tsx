"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = Primitive.Root;

export function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof Primitive.List> & { variant?: "underline" | "pill" }) {
  return (
    <Primitive.List
      data-variant={variant}
      className={cn(
        "flex items-center",
        variant === "underline"
          ? "gap-4 border-b border-border"
          : "gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof Primitive.Trigger> & { variant?: "underline" | "pill" }) {
  return (
    <Primitive.Trigger
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        variant === "underline"
          ? "-mb-px border-b-2 border-transparent pb-2 pt-1 text-muted hover:text-secondary data-[state=active]:border-brand data-[state=active]:text-primary"
          : "rounded px-2.5 py-1 text-muted hover:text-secondary data-[state=active]:bg-surface data-[state=active]:text-primary data-[state=active]:shadow-card",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}
