"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const sideClasses = {
  right: "inset-y-0 right-0 h-full border-l w-full sm:max-w-md",
  left: "inset-y-0 left-0 h-full border-r w-full sm:max-w-md",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] border-t rounded-t-xl",
} as const;

export function DrawerContent({
  className,
  children,
  side = "right",
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: keyof typeof sideClasses;
  showClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border-border bg-surface shadow-overlay outline-none",
          sideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("shrink-0 space-y-1 border-b border-border-subtle px-5 py-4 pr-10", className)}
      {...props}
    />
  );
}

export const DrawerTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-sm font-semibold tracking-tight text-primary", className)}
    {...props}
  />
);

export const DrawerDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-xs text-secondary", className)} {...props} />
);

export function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("shrink-0 border-t border-border-subtle px-5 py-3.5", className)}
      {...props}
    />
  );
}
