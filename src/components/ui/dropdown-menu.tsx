"use client";

import * as React from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;
export const DropdownMenuSub = Primitive.Sub;

const contentClasses =
  "z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface-raised p-1 shadow-overlay data-[state=open]:animate-in-up";

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content sideOffset={sideOffset} className={cn(contentClasses, className)} {...props} />
    </Primitive.Portal>
  );
}

const itemClasses =
  "relative flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-xs text-secondary outline-none transition-colors duration-100 data-[highlighted]:bg-surface-hover data-[highlighted]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted data-[highlighted]:[&_svg]:text-secondary";

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        itemClasses,
        destructive &&
          "text-danger-text data-[highlighted]:bg-danger-subtle data-[highlighted]:text-danger-text [&_svg]:text-danger-text data-[highlighted]:[&_svg]:text-danger-text",
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem className={cn(itemClasses, "pl-7", className)} {...props}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-3.5 text-brand" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem className={cn(itemClasses, "pl-7", className)} {...props}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Circle className="size-1.5 fill-brand text-brand" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}

export function DropdownMenuLabel({
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

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border-subtle", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("ml-auto text-2xs text-muted", className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger className={cn(itemClasses, className)} {...props}>
      {children}
      <ChevronRight className="ml-auto size-3.5" />
    </Primitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent className={cn(contentClasses, className)} {...props} />
    </Primitive.Portal>
  );
}
