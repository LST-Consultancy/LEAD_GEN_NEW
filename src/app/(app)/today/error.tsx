"use client";

import { ErrorState } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export default function TodayError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card>
        <ErrorState
          title="We couldn't assemble your day"
          description="Today reads from your leads, pipeline, tasks and activity. One of those queries failed. Nothing was changed and no points were charged."
          onRetry={reset}
        />
      </Card>
    </div>
  );
}
