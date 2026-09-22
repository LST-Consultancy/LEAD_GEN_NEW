"use client";

import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

export default function PipelineError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card>
        <ErrorState
          title="We couldn't load your pipeline"
          description="No deal was moved and nothing was changed. Retrying usually resolves it."
          onRetry={reset}
        />
      </Card>
    </div>
  );
}
