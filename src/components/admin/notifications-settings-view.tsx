"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { formatAge, formatNumber } from "@/lib/format";
import type { NotificationKindStat } from "@/lib/services/notification-settings";

/**
 * §85 — notification settings.
 *
 * Per-kind in-app switches, beside your own counts for each kind — the number
 * that tells you what is worth muting.
 */
export function NotificationsSettingsView({
  kinds,
  windowDays,
  totalReceived,
  totalUnread,
}: {
  kinds: NotificationKindStat[];
  windowDays: number;
  totalReceived: number;
  totalUnread: number;
}) {
  const noisiest = kinds[0];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Notifications</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Every kind this product can raise, what triggers it, and how often it has actually
          reached you in the last {windowDays} days.
        </p>
      </div>


      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Bell className="size-3.5 text-muted" />
            Your volume
          </CardTitle>
          <span className="text-2xs text-muted">
            {formatNumber(totalReceived)} in {windowDays} days
            {totalUnread > 0 ? ` · ${formatNumber(totalUnread)} unread` : ""}
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          {totalReceived === 0 ? (
            <p className="text-2xs leading-relaxed text-muted">
              Nothing has been raised for you in this window, so there is nothing to tune. The kinds
              below are what would arrive.
            </p>
          ) : (
            <p className="mb-2 text-2xs leading-relaxed text-muted">
              {noisiest && noisiest.received > 0 ? (
                <>
                  Your noisiest is <strong className="text-primary">{noisiest.label}</strong> at{" "}
                  {formatNumber(noisiest.received)} in {windowDays} days
                  {noisiest.actionable
                    ? " — worth keeping, since each one needs a decision."
                    : " — this one is informational, so it is the first candidate to turn down."}
                </>
              ) : null}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted">
                  <th className="pb-1.5 font-semibold">Kind</th>
                  <th className="pb-1.5 text-right font-semibold">Received</th>
                  <th className="pb-1.5 text-right font-semibold">Unread</th>
                  <th className="pb-1.5 text-right font-semibold">Last</th>
                  <th className="pb-1.5 text-right font-semibold">In app</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((k) => (
                  <tr key={k.kind} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-primary">{k.label}</span>
                        {k.actionable ? (
                          <Tooltip content="Each one needs a decision from you, so muting it means missing work.">
                            <span className="cursor-help">
                              <Badge variant="info" size="sm">
                                Needs action
                              </Badge>
                            </span>
                          </Tooltip>
                        ) : (
                          <Tooltip content="Informational. Safe to turn down first if the volume bothers you.">
                            <span className="cursor-help">
                              <Badge variant="neutral" size="sm">
                                For information
                              </Badge>
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-2xs leading-relaxed text-muted">{k.raisedBy}</p>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-secondary">
                      {k.received === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        formatNumber(k.received)
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {k.unread > 0 ? (
                        <span className="text-primary">{formatNumber(k.unread)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-2xs text-muted">
                      {k.lastAt ? formatAge(k.lastAt) : "never"}
                    </td>
                    <td className="py-1.5 text-right">
                      <MuteSwitch kind={k.kind} label={k.label} muted={k.muted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Notifications are per person, not per workspace — these counts are yours. A colleague who
        owns different leads sees a different list. Email and push delivery are not built; these
        arrive in the app only.
      </p>
    </div>
  );
}

function MuteSwitch({ kind, label, muted }: { kind: string; label: string; muted: boolean }) {
  const router = useRouter();
  const [on, setOn] = React.useState(!muted);
  const [pending, setPending] = React.useState(false);
  async function toggle(next: boolean) {
    setOn(next); setPending(true);
    try {
      await api.put("/api/notification-preferences", { kind, muted: !next });
      toast.success(next ? `${label} on` : `${label} muted`, { description: next ? undefined : "The events still appear in activity; only the notification is skipped." });
      router.refresh();
    } catch (err) {
      setOn(!next);
      toast.error("Not saved", { description: `${err instanceof ApiError ? err.message : "The server didn't save it."} Put back as it was.` });
    } finally { setPending(false); }
  }
  return <Switch aria-label={`${label} notifications`} checked={on} disabled={pending} onCheckedChange={(c) => void toggle(c)} />;
}
