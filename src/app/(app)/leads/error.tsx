"use client";

import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

export default function LeadsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card>
        <ErrorState
          title="We couldn't load your leads"
          description="The filter combination may have produced an invalid query, or the database is briefly unreachable. Nothing was changed."
          onRetry={reset}
        />
      </Card>
    </div>
  );
}
