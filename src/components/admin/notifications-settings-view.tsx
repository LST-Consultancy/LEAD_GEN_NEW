"use client";

import { AlertTriangle, Bell, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { formatAge, formatNumber } from "@/lib/format";
import type { NotificationKindStat } from "@/lib/services/notification-settings";

/**
 * §85 — notification settings.
 *
 * No preference store exists, so there are no switches. Instead the screen
 * answers the question a preferences page is really for — "which of these is
 * too noisy?" — with your own counts, which is knowable today.
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

      <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <strong>Per-kind muting is not built.</strong> There is nowhere to store the preference
          yet, so rather than switches that forget what you set, this shows your real volume — the
          number you would use to decide what to mute.
        </span>
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
