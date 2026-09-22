"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Info, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge, formatNumber } from "@/lib/format";
import type { ArchivedLead } from "@/lib/services/archived";

/**
 * §81 — archived leads.
 *
 * The screen's job is to make clear that archiving is reversible and lossless:
 * the score, the origin and the history are all intact, which is exactly what
 * makes restoring safe.
 */
export function ArchivedView({
  leads,
  total,
  autoArchiveAfterDays,
  canEdit,
}: {
  leads: ArchivedLead[];
  total: number;
  autoArchiveAfterDays: number;
  canEdit: boolean;
}) {
  const [query, setQuery] = React.useState("");

  const filtered = query.trim()
    ? leads.filter(
        (l) =>
          l.name.toLowerCase().includes(query.toLowerCase()) ||
          l.companyName.toLowerCase().includes(query.toLowerCase())
      )
    : leads;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Archived Leads</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Out of the working list, not out of the record. An archived lead keeps its score, its
          history and the signal that surfaced it — restoring puts it back exactly as it was.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or company…"
          className="sm:max-w-xs"
          aria-label="Search archived leads"
        />
        <span className="text-2xs text-muted">
          {filtered.length === total
            ? `${formatNumber(total)} archived`
            : `${formatNumber(filtered.length)} of ${formatNumber(total)}`}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Archive className="size-3.5 text-muted" />
            Archived
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={Archive}
              compact
              title={total === 0 ? "Nothing is archived" : "Nothing matches"}
              description={
                total === 0
                  ? `Leads are archived by hand, or automatically after ${autoArchiveAfterDays} days with no activity. Archiving clears the working list without losing anything.`
                  : "No archived lead matches that search."
              }
            />
          ) : (
            <div className="space-y-1.5">
              {filtered.map((l) => (
                <ArchivedRow key={l.id} lead={l} canEdit={canEdit} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Leads with no activity for {autoArchiveAfterDays} days are archived automatically. This is
        not deletion — nothing here is on a purge schedule, and none of it appears in the{" "}
        <Link href="/recycle-bin" className="text-brand-text underline-offset-2 hover:underline">
          Recycle Bin
        </Link>
        .
      </p>
    </div>
  );
}

function ArchivedRow({ lead, canEdit }: { lead: ArchivedLead; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/leads/${lead.id}/restore`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That couldn't be restored. Nothing was changed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/leads/${lead.id}`}
              className="truncate text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {lead.name}
            </Link>
            <span className="truncate text-2xs text-muted">{lead.companyName}</span>
            <Badge variant="neutral" size="sm">
              Tier {lead.tier}
            </Badge>
            <Tooltip content="The score it had when archived. Restoring does not recompute it — a rescore does.">
              <span className="cursor-help tabular-nums text-2xs text-muted">
                {lead.score.toFixed(1)}
              </span>
            </Tooltip>
          </div>
          <p className="truncate text-2xs text-secondary">{lead.surfacedReason}</p>
          <p className="text-2xs text-muted">
            archived {formatAge(lead.archivedAt)}
            {lead.lastActivityAt ? ` · last activity ${formatAge(lead.lastActivityAt)}` : " · no activity recorded"}
            {lead.discardReason ? ` · discarded: ${lead.discardReason}` : ""}
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restore()}>
            <RotateCcw />
            {busy ? "Restoring…" : "Restore"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 rounded border border-danger-border bg-danger-subtle p-1.5 text-2xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
