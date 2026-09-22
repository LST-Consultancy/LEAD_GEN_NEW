"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = Primitive.Root;
export const SelectValue = Primitive.Value;
export const SelectGroup = Primitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-primary shadow-card transition-colors duration-150",
        "hover:border-border-strong",
        "focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "data-[placeholder]:text-muted [&>span]:truncate",
        className
      )}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          "z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-overlay",
          position === "popper" && "w-[var(--radix-select-trigger-width)]",
          className
        )}
        {...props}
      >
        <Primitive.Viewport className="p-1">{children}</Primitive.Viewport>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded py-1.5 pl-7 pr-2 text-xs text-secondary outline-none",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-primary",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-3.5 text-brand" />
        </Primitive.ItemIndicator>
      </span>
      <Primitive.ItemText>{children}</Primitive.ItemText>
    </Primitive.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn("px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted", className)}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border-subtle", className)} {...props} />;
}
