"use client";

import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

export default function DossierError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card>
        <ErrorState
          title="We couldn't load this lead"
          description="The dossier pulls from signals, scores, deals, messages and research in one query. Something in that chain failed. Nothing was changed."
          onRetry={reset}
        />
      </Card>
    </div>
  );
}
