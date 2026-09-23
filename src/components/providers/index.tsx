"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          // Don't retry permission or validation failures — they won't fix themselves.
          const status = (error as { status?: number })?.status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /**
   * The request's CSP nonce.
   *
   * `next-themes` renders its own inline script — the one that sets the theme
   * before first paint so the page does not flash white. Next nonces the
   * scripts *it* generates, not this one, so without this the policy blocks it
   * and every visitor gets the flash the script exists to prevent.
   */
  nonce?: string;
}) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="sr-theme"
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250} skipDelayDuration={300}>
          {children}
          <Toaster
            position="bottom-right"
            gap={8}
            toastOptions={{
              classNames: {
                toast:
                  "!bg-surface-raised !border-border !text-primary !shadow-overlay !rounded-lg !text-xs !font-sans",
                description: "!text-secondary",
                actionButton: "!bg-brand !text-brand-fg !rounded !text-2xs",
                cancelButton: "!bg-surface-sunken !text-secondary !rounded !text-2xs",
                error: "!border-danger-border",
                success: "!border-success-border",
                warning: "!border-warning-border",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
