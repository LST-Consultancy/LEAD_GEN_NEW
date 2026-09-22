"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Info, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { formatAge, formatDate, formatNumber, formatRelative } from "@/lib/format";
import type { BinEntry } from "@/lib/services/recycle-bin";

/**
 * §82 — the recycle bin.
 *
 * The purge date is the point of this screen. "Deleted items are kept for a
 * while" is not something anyone can plan around, so each row carries the date
 * its data actually goes.
 */
export function RecycleBinView({
  entries,
  retentionDays,
  restoredCount,
  canRestore,
}: {
  entries: BinEntry[];
  retentionDays: number;
  restoredCount: number;
  canRestore: boolean;
}) {
  const soon = entries.filter(
    (e) => new Date(e.purgeAfter).getTime() - Date.now() < 7 * 86_400_000
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Recycle Bin</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Deleting never removes tenant data immediately. Everything here is kept for{" "}
          {retentionDays} days from deletion, and each row shows the date it actually goes.
        </p>
      </div>

      {soon > 0 ? (
        <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {soon} {soon === 1 ? "item purges" : "items purge"} within seven days. After that date
            the data is gone and restore will not bring it back.
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Trash2 className="size-3.5 text-muted" />
            Waiting to be purged
          </CardTitle>
          <span className="text-2xs text-muted">
            {formatNumber(entries.length)} {entries.length === 1 ? "item" : "items"}
            {restoredCount > 0 ? ` · ${formatNumber(restoredCount)} restored previously` : ""}
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          {entries.length === 0 ? (
            <EmptyState
              icon={Trash2}
              compact
              title="Nothing is waiting to be purged"
              description="Deleted leads, lists, sequences, playbooks and knowledge entries appear here with the date their data is removed."
            />
          ) : (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <BinRow key={e.id} entry={e} canRestore={canRestore} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Retention is set per workspace in{" "}
        <Link href="/settings/privacy" className="text-brand-text underline-offset-2 hover:underline">
          Data &amp; Privacy
        </Link>
        . Deleting a thing never rewrites history — a removed search phrase stops its watch but
        leaves the leads it found, so won revenue keeps its origin.
      </p>
    </div>
  );
}

function BinRow({ entry, canRestore }: { entry: BinEntry; canRestore: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/recycle-bin/${entry.id}/restore`);
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
            <Badge variant="neutral" size="sm">
              {entry.typeLabel}
            </Badge>
            <span className="truncate text-xs font-medium text-primary">{entry.label}</span>
          </div>
          <p className="text-2xs text-muted">
            deleted by {entry.deletedByLabel} {formatAge(entry.deletedAt)} ·{" "}
            <Tooltip content={`Data is removed on ${formatDate(entry.purgeAfter)}.`}>
              <span className="cursor-help">purges {formatRelative(entry.purgeAfter)}</span>
            </Tooltip>
          </p>
        </div>
        {entry.restorable && canRestore ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restore()}>
            <RotateCcw />
            {busy ? "Restoring…" : "Restore"}
          </Button>
        ) : entry.restorable ? null : (
          <Tooltip content={entry.blockedBecause ?? "Not restorable."}>
            <span className="cursor-help">
              <Badge variant="warning" size="sm">
                Can&apos;t restore
              </Badge>
            </span>
          </Tooltip>
        )}
      </div>
      {entry.blockedBecause ? (
        <p className="mt-1 text-2xs leading-relaxed text-muted">{entry.blockedBecause}</p>
      ) : null}
      {error ? (
        <p className="mt-1 rounded border border-danger-border bg-danger-subtle p-1.5 text-2xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
