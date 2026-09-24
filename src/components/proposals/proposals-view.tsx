"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  Link2,
  Send,
  ThumbsDown,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatInr, formatInrCompact, formatAge, formatNumber } from "@/lib/format";

type Proposal = {
  id: string;
  title: string;
  state: string;
  storedState: string;
  subtotalInr: number;
  taxRate: number;
  taxInr: number;
  totalInr: number;
  validUntil: string | null;
  daysUntilExpiry: number | null;
  sentAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  recordedViews: number;
  acceptedAt: string | null;
  declinedAt: string | null;
  company: { id: string; name: string; industry: string | null } | null;
  lead: { id: string; name: string } | null;
  deal: { id: string; title: string; status: string } | null;
  items: { id: string; name: string; quantity: number; unit: string; unitPriceInr: number; amountInr: number }[];
  publicPath: string | null;
  totalsMismatch: string[] | null;
  updatedAt: string;
};

const STATE_META: Record<
  string,
  { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info"; meaning: string }
> = {
  DRAFT: {
    label: "Draft",
    variant: "neutral",
    meaning: "Not sent. The public link does not work yet.",
  },
  SENT: {
    label: "Sent",
    variant: "info",
    meaning: "The link is live, but nobody outside your team has opened it.",
  },
  VIEWED: {
    label: "Viewed",
    variant: "info",
    meaning: "Opened by someone who is not on your team.",
  },
  ACCEPTED: { label: "Accepted", variant: "success", meaning: "Answered yes." },
  DECLINED: { label: "Declined", variant: "danger", meaning: "Answered no." },
  EXPIRED: {
    label: "Expired",
    variant: "warning",
    meaning: "Past its validity date, so it can no longer be accepted from the link.",
  },
};

export function ProposalsView({
  proposals,
  emailConfigured,
  baseUrl,
}: {
  proposals: Proposal[];
  emailConfigured: boolean;
  baseUrl: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const live = proposals.filter((p) => p.state === "SENT" || p.state === "VIEWED");
  const accepted = proposals.filter((p) => p.state === "ACCEPTED");
  const mismatched = proposals.filter((p) => p.totalsMismatch !== null);

  const liveValue = live.reduce((s, p) => s + p.totalInr, 0);
  const wonValue = accepted.reduce((s, p) => s + p.totalInr, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-primary">Proposals</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Each one has a private link a customer can read and answer. Views, acceptances and
          declines are recorded as they happen, so the pipeline reflects what the buyer actually
          did rather than what was reported.
        </p>
        </div>
        <Button variant="primary" size="sm" asChild><Link href="/proposals/new">New proposal</Link></Button>
      </div>

      {mismatched.length > 0 ? (
        <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs text-danger-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>
            {mismatched.length === 1
              ? "One proposal's totals do not match its line items"
              : `${mismatched.length} proposals have totals that do not match their line items`}
          </strong>
          . Nothing has been changed automatically — altering a figure a customer may already
          have seen would be worse than the mismatch. Open each one with Edit, check the lines, and save to recompute.
        </div>
      ) : null}

      {!emailConfigured ? (
        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
          <Link2 className="mr-1 inline size-3" />
          No mailbox is connected, so proposals cannot be emailed from here. Sending still works:
          it makes the link live, and you share the link yourself.
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Out for decision" value={formatNumber(live.length)} hint={formatInrCompact(liveValue)} />
        <Stat
          label="Accepted"
          value={formatNumber(accepted.length)}
          hint={formatInrCompact(wonValue)}
        />
        <Stat
          label="Drafts"
          value={formatNumber(proposals.filter((p) => p.state === "DRAFT").length)}
          hint="not yet live"
        />
        <Stat
          label="Expired"
          value={formatNumber(proposals.filter((p) => p.state === "EXPIRED").length)}
          hint="past the validity date"
        />
      </div>

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="No proposals yet"
              description="A proposal here is a page with a private link, not an attachment. That is what makes views, acceptances and declines real events rather than things someone remembers to tell you."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              baseUrl={baseUrl}
              emailConfigured={emailConfigured}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular text-primary">{value}</p>
      <p className="text-2xs text-muted">{hint}</p>
    </div>
  );
}

function ProposalCard({
  proposal,
  baseUrl,
  emailConfigured,
  expanded,
  onToggle,
}: {
  proposal: Proposal;
  baseUrl: string;
  emailConfigured: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [publicPath, setPublicPath] = useState<string | null>(proposal.publicPath);

  const meta = STATE_META[proposal.state] ?? STATE_META.DRAFT;
  const isLive = proposal.sentAt !== null;
  const decided = proposal.acceptedAt !== null || proposal.declinedAt !== null;

  const act = async (fn: () => Promise<{ note: string; publicPath?: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn();
      if (res.publicPath) setPublicPath(res.publicPath);
      setMessage({ tone: "ok", text: res.note });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const path = publicPath;
    if (!path) {
      setMessage({ tone: "bad", text: "This proposal has no live link yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(`${baseUrl}${path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; show the URL so it is still usable.
      setMessage({ tone: "ok", text: `${baseUrl}${path}` });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-1.5">
              <span className="truncate">{proposal.title}</span>
              <Tooltip content={meta.meaning}>
                <span className="cursor-help">
                  <Badge variant={meta.variant} size="sm">
                    {meta.label}
                  </Badge>
                </span>
              </Tooltip>
              {proposal.state === "EXPIRED" && proposal.storedState !== "EXPIRED" ? (
                <Tooltip content="Past its date. The nightly sweep has not recorded it yet, but it already cannot be accepted.">
                  <span className="cursor-help text-2xs text-muted">not yet swept</span>
                </Tooltip>
              ) : null}
              {proposal.totalsMismatch ? (
                <Tooltip content={proposal.totalsMismatch.join("; ")}>
                  <span className="cursor-help">
                    <Badge variant="danger" size="sm">
                      <AlertTriangle className="size-2.5" />
                      Totals off
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
            </CardTitle>
            <p className="mt-0.5 truncate text-2xs text-muted">
              {proposal.company?.name ?? "No company"}
              {proposal.lead ? (
                <>
                  {" · "}
                  <Link href={`/leads/${proposal.lead.id}`} className="hover:underline">
                    {proposal.lead.name}
                  </Link>
                </>
              ) : null}
              {proposal.validUntil && proposal.daysUntilExpiry !== null && !decided ? (
                <>
                  {" · "}
                  <span
                    className={cn(
                      proposal.daysUntilExpiry < 0
                        ? "text-warning-text"
                        : proposal.daysUntilExpiry <= 3
                          ? "text-warning-text"
                          : "text-muted"
                    )}
                  >
                    {proposal.daysUntilExpiry < 0
                      ? `expired ${Math.abs(proposal.daysUntilExpiry)}d ago`
                      : proposal.daysUntilExpiry === 0
                        ? "valid until end of today"
                        : `${proposal.daysUntilExpiry}d left`}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="text-right">
            <p className="text-2xs text-muted">Total incl. GST</p>
            <p className="text-sm font-semibold tabular text-primary">
              {formatInr(proposal.totalInr)}
            </p>
          </div>
          {isLive ? (
            <Tooltip content={copied ? "Copied" : "Copy the customer's link"}>
              <Button size="icon-xs" variant="ghost" onClick={() => void copyLink()} aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </Tooltip>
          ) : null}
          {!isLive ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void act(() => api.post(`/api/proposals/${proposal.id}/send`, {}))}
            >
              <Send />
              Make link live
            </Button>
          ) : null}
          {!isLive && emailConfigured ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act(() => api.post(`/api/proposals/${proposal.id}/send`, { byEmail: true }))}
            >
              Make live and email
            </Button>
          ) : null}
          {proposal.storedState !== "ACCEPTED" ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/proposals/${proposal.id}/edit`}>Edit</Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {message ? (
        <div className="px-4 pb-2">
          <p
            className={cn(
              "break-all rounded-md px-2.5 py-2 text-2xs",
              message.tone === "ok"
                ? "border border-info-border bg-info-subtle text-info-text"
                : "border border-danger-border bg-danger-subtle text-danger-text"
            )}
          >
            {message.text}
          </p>
        </div>
      ) : null}

      {expanded ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          <ViewEvidence proposal={proposal} />

          <div className="overflow-x-auto rounded-md border border-border-subtle">
            <table className="w-full text-xs">
              <caption className="sr-only">Line items</caption>
              <thead className="bg-surface-sunken">
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="px-2.5 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted">
                    Item
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Qty
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Unit
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-right text-2xs font-semibold uppercase tracking-wider text-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposal.items.map((i) => (
                  <tr key={i.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-2.5 py-1.5 text-primary">{i.name}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular text-secondary">
                      {i.quantity} {i.unit}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular text-secondary">
                      {formatInr(i.unitPriceInr)}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular font-medium text-primary">
                      {formatInr(i.amountInr)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-sunken">
                <tr>
                  <td colSpan={3} className="px-2.5 py-1 text-right text-2xs text-muted">
                    Subtotal
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1 text-right tabular text-secondary">
                    {formatInr(proposal.subtotalInr)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-2.5 py-1 text-right text-2xs text-muted">
                    GST {proposal.taxRate}%
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1 text-right tabular text-secondary">
                    {formatInr(proposal.taxInr)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isLive && publicPath ? (
              <Button size="xs" variant="ghost" asChild>
                <a href={publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open as the customer sees it
                </a>
              </Button>
            ) : null}

            {isLive && !decided ? (
              declining ? (
                <div className="flex w-full flex-col gap-1.5">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why was it declined? Price, timing, lost to someone…"
                    className="text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="danger"
                      disabled={busy || reason.trim().length < 3}
                      onClick={() =>
                        void act(() =>
                          api.post(`/api/proposals/${proposal.id}/decision`, {
                            decision: "decline",
                            reason,
                          })
                        )
                      }
                    >
                      <ThumbsDown />
                      Record decline
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setDeclining(false)}>
                      <X />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Tooltip content="Use this when they told you outside the app — a call, a reply, a signed PDF.">
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          api.post(`/api/proposals/${proposal.id}/decision`, {
                            decision: "accept",
                          })
                        )
                      }
                    >
                      <Check />
                      Record acceptance
                    </Button>
                  </Tooltip>
                  <Button size="xs" variant="ghost" onClick={() => setDeclining(true)}>
                    <ThumbsDown />
                    Record decline
                  </Button>
                </>
              )
            ) : null}

            {proposal.state !== "ACCEPTED" ? (
              <Tooltip content="Moves it to the recycle bin and stops the link working.">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => api.del(`/api/proposals/${proposal.id}`))}
                  aria-label="Delete proposal"
                >
                  <Trash2 />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="An accepted proposal is a record of an agreement and cannot be deleted.">
                <span className="text-2xs text-muted">Kept — accepted</span>
              </Tooltip>
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * View evidence.
 *
 * Shows the counter *and* how many rows back it, because the counter alone is
 * the kind of number a seller reads as intent. Views by the owning team are
 * never recorded, which is stated here so the number can be trusted.
 */
function ViewEvidence({ proposal }: { proposal: Proposal }) {
  if (!proposal.sentAt) {
    return (
      <p className="text-2xs text-muted">
        <Clock className="mr-0.5 inline size-2.5" />
        Not sent yet, so there is nothing to track.
      </p>
    );
  }

  if (proposal.viewCount === 0) {
    return (
      <p className="text-2xs text-muted">
        <Eye className="mr-0.5 inline size-2.5" />
        Live since {formatAge(proposal.sentAt)} ago, not opened by anyone outside your team yet.
        Your own visits are deliberately not counted.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-secondary">
      <span>
        <Eye className="mr-0.5 inline size-2.5" />
        Opened <strong className="tabular">{proposal.viewCount}</strong>{" "}
        {proposal.viewCount === 1 ? "time" : "times"}
        {proposal.recordedViews !== proposal.viewCount ? (
          <Tooltip
            content={`The counter says ${proposal.viewCount}; ${proposal.recordedViews} individual visits are on record. Older visit rows may have been trimmed.`}
          >
            <span className="ml-1 cursor-help text-muted">
              ({proposal.recordedViews} on record)
            </span>
          </Tooltip>
        ) : null}
      </span>
      {proposal.firstViewedAt ? <span>first {formatAge(proposal.firstViewedAt)}</span> : null}
      {proposal.lastViewedAt ? <span>last {formatAge(proposal.lastViewedAt)}</span> : null}
      <span className="text-muted">your team&apos;s visits excluded</span>
    </div>
  );
}
