"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, Download, Info, Shield, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";

/**
 * §83 — data and privacy.
 *
 * Two retention numbers with very different consequences share this screen, so
 * each is stated in terms of what it destroys and when. The rest of the screen
 * is about the rights a data subject has, and it is explicit that the
 * self-serve export and erasure flows are not built — an unanswered request is
 * a compliance failure, and pretending otherwise would be worse than saying so.
 */
export function PrivacyView({
  archiveAfterDays,
  recycleBinDays,
  archivedCount,
  pendingPurge,
  leadCount,
  canManage,
}: {
  archiveAfterDays: number;
  recycleBinDays: number;
  archivedCount: number;
  pendingPurge: number;
  leadCount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [archive, setArchive] = React.useState(String(archiveAfterDays));
  const [bin, setBin] = React.useState(String(recycleBinDays));
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = archive !== String(archiveAfterDays) || bin !== String(recycleBinDays);
  const shortening = Number(bin) < recycleBinDays;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/api/workspace/settings", {
        archiveAfterDays: Number(archive),
        recycleBinDays: Number(bin),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Data &amp; Privacy</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          How long data is kept, what happens when it goes, and what a person can ask you for
          about themselves.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Shield className="size-3.5 text-muted" />
            Retention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="p-archive"
                className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
              >
                Archive after
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="p-archive"
                  type="number"
                  min={7}
                  max={365}
                  value={archive}
                  disabled={!canManage}
                  onChange={(e) => setArchive(e.target.value)}
                  className="max-w-24 tabular-nums"
                />
                <span className="text-2xs text-muted">days with no activity</span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted">
                Reversible and lossless. The lead leaves the working list, keeps its score and
                history, and can be restored at any time.{" "}
                {archivedCount > 0 ? (
                  <>
                    <Link
                      href="/archived"
                      className="text-brand-text underline-offset-2 hover:underline"
                    >
                      {formatNumber(archivedCount)} archived
                    </Link>{" "}
                    of {formatNumber(leadCount)} leads.
                  </>
                ) : (
                  "Nothing is archived right now."
                )}
              </p>
            </div>

            <div>
              <label
                htmlFor="p-bin"
                className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted"
              >
                Purge deleted after
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="p-bin"
                  type="number"
                  min={7}
                  max={365}
                  value={bin}
                  disabled={!canManage}
                  onChange={(e) => setBin(e.target.value)}
                  className="max-w-24 tabular-nums"
                />
                <span className="text-2xs text-muted">days after deletion</span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted">
                <strong className="text-warning-text">Irreversible.</strong> After this the data is
                gone and restore will not bring it back.{" "}
                {pendingPurge > 0 ? (
                  <>
                    <Link
                      href="/recycle-bin"
                      className="text-brand-text underline-offset-2 hover:underline"
                    >
                      {formatNumber(pendingPurge)} waiting
                    </Link>{" "}
                    to be purged.
                  </>
                ) : (
                  "Nothing is waiting to be purged."
                )}
              </p>
            </div>
          </div>

          {shortening ? (
            <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Shortening this brings forward the purge date of data already deleted. Items whose
                new date has already passed become unrecoverable at the next purge run.
              </span>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-danger-border bg-danger-subtle p-2 text-2xs text-danger-text">
              {error}
            </p>
          ) : null}

          {canManage ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save retention"}
              </Button>
              {saved && !dirty ? (
                <span className="flex items-center gap-1 text-2xs text-success-text">
                  <Check className="size-3" />
                  Saved
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-2xs text-muted">
              You don&apos;t have permission to change retention. Ask an owner or admin.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Download className="size-3.5 text-muted" />
            Requests from a data subject
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-2.5 text-2xs leading-relaxed text-warning-text">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>Self-serve export and erasure are not built.</strong> Under the DPDP Act a
              person can ask what you hold about them and ask you to erase it, and you have to
              answer. Right now that is a manual job — there is no button here that does it, and
              none that pretends to.
            </span>
          </div>

          <Request
            title="Access — what do you hold about me?"
            today="Search the person by name or email, open the lead, and its dossier is the complete record: company details, contact methods, every signal, every message and every note."
            missing="A single export of one person's data as a file you can send them."
          />
          <Request
            title="Erasure — delete what you hold"
            today="Delete the lead. It goes to the recycle bin and is purged on the date shown there. Add the address to the suppression list so a later import doesn't bring them back."
            missing="A verified request flow, and an erasure that also reaches messages and audit entries where the law allows removing them."
          />
          <Request
            title="Objection — stop contacting me"
            today="Fully built. Record a stop and that person is suppressed on every channel immediately, not just the one they asked on."
            missing={null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Trash2 className="size-3.5 text-muted" />
            What deletion actually does
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0 text-2xs leading-relaxed text-secondary">
          <p>
            <strong className="text-primary">Nothing is hard-deleted.</strong> Every deletion marks
            the row and indexes it in the recycle bin with a purge date, so restore and the
            countdown both have something real to read.
          </p>
          <p>
            <strong className="text-primary">Deleting does not rewrite history.</strong> Removing a
            search phrase stops the watch but leaves the leads it found, so revenue you won keeps
            its origin. An ICP profile cannot be deleted while leads are scored against it.
          </p>
          <p>
            <strong className="text-primary">The audit log is append-only.</strong> Every change
            keeps its before and after, with the person or agent that made it — which is what makes
            a deletion provable rather than merely claimed.{" "}
            <Link href="/settings/audit" className="text-brand-text underline-offset-2 hover:underline">
              Audit Log
            </Link>
          </p>
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        This screen describes what the product does. It is not legal advice, and the obligations
        that apply to you depend on what you collect and where your contacts are.
      </p>
    </div>
  );
}

function Request({
  title,
  today,
  missing,
}: {
  title: string;
  today: string;
  missing: string | null;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-primary">{title}</span>
        <Badge variant={missing ? "warning" : "success"} size="sm">
          {missing ? "Manual today" : "Built"}
        </Badge>
      </div>
      <p className="mt-0.5 text-2xs leading-relaxed text-secondary">
        <strong>How to answer it now:</strong> {today}
      </p>
      {missing ? (
        <p className="text-2xs leading-relaxed text-muted">
          <strong>Not built:</strong> {missing}
        </p>
      ) : null}
    </div>
  );
}
