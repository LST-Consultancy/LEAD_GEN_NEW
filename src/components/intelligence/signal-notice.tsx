import { AlertTriangle, Check } from "lucide-react";

/**
 * The staleness notice every signal-derived screen carries.
 *
 * Shared deliberately: four screens describing the same data must not imply
 * different things about how current it is.
 */
export function SignalNotice({
  freshness,
}: {
  freshness: { connected: boolean; notice: string };
}) {
  if (freshness.connected) {
    return (
      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
        <Check className="mr-1 inline size-3 text-success-text" />
        {freshness.notice}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
      <AlertTriangle className="mr-1 inline size-3.5" />
      {freshness.notice}
    </div>
  );
}
