"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, Bookmark, Info, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge, formatNumber } from "@/lib/format";
import { buildLeadQuery } from "@/lib/leads/params";
import type { LeadFilter } from "@/lib/leads/filter";

type Saved = {
  id: string;
  name: string;
  surface: string;
  filter: unknown;
  alertEnabled: boolean;
  frequency: string;
  lastAlertAt: string | null;
  createdAt: string;
  matches: number | null;
  broken: boolean;
  countable: boolean;
};

/** Opens the search with its stored filter restored, not just the screen it came from. */
function searchHref(s: Pick<Saved, "id" | "surface" | "filter" | "broken">): string {
  if (s.surface === "leads") return s.broken ? "/leads" : `/leads${buildLeadQuery((s.filter ?? {}) as Partial<LeadFilter>)}`;
  // Opportunity watches run on a schedule; opening one restores its query, sources and options.
  if (s.surface === "opportunities") return `/find-leads?watch=${s.id}`;
  return `/${s.surface}`;
}

export function AlertsView({
  searches,
  discoveryConnected,
}: {
  searches: Saved[];
  discoveryConnected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const alerting = searches.filter((s) => s.alertEnabled);
  const broken = searches.filter((s) => s.broken);

  const act = async (id: string, fn: () => Promise<{ note: string }>) => {
    setBusy(id);
    try {
      const res = await fn();
      setMessage(res.note);
      setConfirming(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Saved &amp; Alerts</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Any search can be saved, and any saved search can tell you when something new matches
          it.
        </p>
      </div>

      {!discoveryConnected && alerting.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {alerting.length} {alerting.length === 1 ? "alert is" : "alerts are"} on, but new
            leads only arrive by import.
          </strong>{" "}
          An alert fires when something <em>new</em> matches; with no discovery source connected,
          nothing new appears on its own. The searches are real and the alerts will work — there
          is just nothing yet to trigger them.
        </div>
      ) : null}

      {broken.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {broken.length === 1
            ? `"${broken[0].name}" has a filter this app can no longer run.`
            : `${broken.length} saved searches have filters this app can no longer run.`}
        </div>
      ) : null}

      {message ? (
        <p className="rounded-md border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text">
          {message}
        </p>
      ) : null}

      {searches.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Bookmark}
              title="Nothing saved"
              description="Filter the Leads screen to something worth watching, then save it. The URL already carries the filter, so a saved search is just that URL with a name and an alert setting."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Saved searches</CardTitle>
              <p className="mt-0.5 text-2xs text-muted">
                {alerting.length} of {searches.length} alerting.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-subtle">
              {searches.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={searchHref(s)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                      <Badge variant="neutral" size="sm">
                        {s.surface}
                      </Badge>
                      {s.broken ? (
                        <Badge variant="danger" size="sm">
                          Filter broken
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-2xs text-muted">
                      {s.alertEnabled
                        ? `Alerting ${s.frequency.toLowerCase()}`
                        : "Not alerting"}
                      {" · "}
                      {s.lastAlertAt ? `last fired ${formatAge(s.lastAlertAt)}` : "never fired"}
                      {" · saved "}
                      {formatAge(s.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    {s.countable && !s.broken ? (
                      <>
                        <p className="text-sm font-semibold tabular text-primary">
                          {formatNumber(s.matches ?? 0)}
                        </p>
                        <p className="text-2xs text-muted">matching now</p>
                      </>
                    ) : (
                      <Tooltip
                        content={
                          s.broken
                            ? "The filter no longer parses, so it cannot be counted."
                            : `Counting is only wired for lead searches, not "${s.surface}".`
                        }
                      >
                        <p className="cursor-help text-2xs text-muted">not counted</p>
                      </Tooltip>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip
                      content={
                        s.alertEnabled
                          ? "Turn alerts off. The search is kept."
                          : "Tell me when something new matches."
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {s.alertEnabled ? (
                          <Bell className="size-3 text-success-text" />
                        ) : (
                          <BellOff className="size-3 text-muted" />
                        )}
                        <Switch
                          checked={s.alertEnabled}
                          disabled={busy === s.id}
                          onCheckedChange={(v) =>
                            void act(s.id, () =>
                              api.patch(`/api/saved-searches/${s.id}`, { alertEnabled: v })
                            )
                          }
                          aria-label={`${s.alertEnabled ? "Disable" : "Enable"} alerts for ${s.name}`}
                        />
                      </span>
                    </Tooltip>

                    {confirming === s.id ? (
                      <>
                        <Button
                          size="xs"
                          variant="danger"
                          disabled={busy === s.id}
                          onClick={() =>
                            void act(s.id, () => api.del(`/api/saved-searches/${s.id}`))
                          }
                        >
                          Remove
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setConfirming(s.id)}
                        aria-label={`Remove ${s.name}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-2xs text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Removing a saved search removes only the stored query — no leads are affected.
      </p>
    </div>
  );
}
