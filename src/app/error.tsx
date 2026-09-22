"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/states";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-card">
        <ErrorState
          title="This screen failed to load"
          description="Nothing in your workspace was changed and no points were charged. Retrying usually resolves it."
          onRetry={reset}
        />
        {error.digest ? (
          <p className="border-t border-border-subtle px-6 py-2.5 text-center font-mono text-2xs text-muted">
            reference {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
