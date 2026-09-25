"use client";

import type * as React from "react";

import Link from "next/link";
import { AlertTriangle, Check, Inbox, Info, Mail, Shield, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import type { ProviderDescriptor } from "@/lib/outreach/provider";
import type { ChannelReach } from "@/lib/services/channels";

/**
 * Settings → Email Accounts.
 *
 * The provider abstraction is real and reads the environment, so this screen
 * reports actual state rather than a mock-up. The provider list below is the
 * server-wide relay; a workspace's own mailboxes (SMTP, Gmail or Microsoft 365
 * over OAuth) are connected in the panel rendered as `children`.
 */
export function EmailAccountsView({
  providers,
  active,
  canSend,
  canReceive,
  reach,
  domainChecks,
  workspaceSender = null,
  children,
}: {
  providers: (ProviderDescriptor & { adapterBuilt: boolean })[];
  active: string | null;
  /** Credentialled *and* backed by an adapter. Either alone sends nothing. */
  canSend: boolean;
  canReceive: boolean;
  reach: ChannelReach;
  domainChecks: { record: string; purpose: string; failureMode: string }[];
  /** The workspace mailbox new messages send from, when one is set up. */
  workspaceSender?: string | null;
  /** Rendered under the sending status: the workspace's mailboxes. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Email Accounts</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          The mailbox that sequences send from, and whether replies can be read back. Reading
          replies is not optional — a sequence that keeps emailing someone who already answered is
          the fastest way to lose them.
        </p>
      </div>

      {workspaceSender ? (
        <div className={`rounded-lg border px-3 py-2.5 text-xs ${canReceive ? "border-success-border bg-success-subtle text-success-text" : "border-warning-border bg-warning-subtle text-warning-text"}`}>
          {canReceive ? <Check className="mr-1 inline size-3.5" /> : <AlertTriangle className="mr-1 inline size-3.5" />}
          New messages send from <strong>{workspaceSender}</strong>, this workspace&apos;s default mailbox
          {canReceive ? ", and a connected mailbox reads replies, so stop-on-reply is honoured automatically." : ". No mailbox is read for replies, so stop-on-reply sequences stay blocked until one is."}
        </div>
      ) : active && canSend ? (
        canReceive ? (
          <div className="rounded-lg border border-success-border bg-success-subtle px-3 py-2.5 text-xs text-success-text">
            <Check className="mr-1 inline size-3.5" />
            <strong>{active}</strong> is connected and sending, and a connected mailbox reads
            replies, so stop-on-reply is honoured automatically.
          </div>
        ) : (
          <div className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-xs text-warning-text">
            <AlertTriangle className="mr-1 inline size-3.5" />
            <strong>{active}</strong> is sending, but no mailbox is read for replies. Enrolling into
            stop-on-reply sequences stays blocked until one is connected under Reply reading above —
            a sequence that keeps emailing someone who already answered is the fastest way to lose them.
          </div>
        )
      ) : active ? (
        <div className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>{active} is credentialled, but has no delivery adapter in this version.</strong>{" "}
          Nothing sends. SMTP and Resend do have one — switching to either makes the same sequences
          send without any other change.
        </div>
      ) : (
        <div className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-xs text-warning-text">
          <AlertTriangle className="mr-1 inline size-3.5" />
          <strong>No mailbox is connected, so nothing sends.</strong> Everything around the send
          is real and running: sequences step on schedule, the send window is enforced, suppression
          and bounce limits are checked, and every hold is recorded with its reason. Set{" "}
          <span className="font-mono">SMTP_URL</span> and{" "}
          <span className="font-mono">EMAIL_FROM</span> and the same sequences start sending — the
          SMTP and Resend adapters are built and tested.
        </div>
      )}

      {children}

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Inbox className="size-3.5 text-muted" />
            Who you could reach
          </CardTitle>
          <span className="text-2xs text-muted">across leads you can see</span>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 sm:grid-cols-4">
            <Figure label="Leads" value={reach.totalLeads} />
            <Figure
              label="With an address"
              value={reach.reachable}
              hint="Work or personal email recorded on the contact."
            />
            <Figure
              label="Revealed"
              value={reach.revealed}
              hint="A locked address cannot be sent to — it has not been revealed yet."
            />
            <Figure
              label="Suppressed"
              value={reach.suppressed}
              hint="Opted out, or an address on the suppression list. A locked address has no value to match against, so this is a planning figure — the send-time check re-tests the revealed address and is what actually stops a message."
              muted
            />
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-muted">
            These are counted from contact records, not estimated. The gap between{" "}
            <em>with an address</em> and <em>revealed</em> is what reveals would cost — see{" "}
            <Link href="/settings/billing" className="text-brand-text underline-offset-2 hover:underline">
              Billing &amp; Points
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Mail className="size-3.5 text-muted" />
            Server relay
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          <p className="text-2xs leading-relaxed text-muted">
            The server-wide fallback, used only when this workspace has no sending mailbox above. It is
            set in the server&apos;s environment, not here. Two different things have to be true for it
            to send: a credential, and an adapter that knows how to use it. Both are shown, because a credential for a provider with no adapter
            sends nothing — and sends it silently.
          </p>
          {providers.map((p) => (
            <div
              key={p.name}
              className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {active === p.name ? (
                  <Check className="size-3 text-success-text" />
                ) : (
                  <X className="size-3 text-muted" />
                )}
                <span className="text-xs font-medium text-primary">{p.label}</span>
                {active === p.name ? (
                  <Badge variant="success" size="sm">
                    Credentialled
                  </Badge>
                ) : (
                  <Badge variant="neutral" size="sm">
                    Not connected
                  </Badge>
                )}
                {p.adapterBuilt ? (
                  <Tooltip content="An adapter for this provider is written and tested, so a credential is all it needs.">
                    <span className="cursor-help">
                      <Badge variant="success" size="sm">
                        Adapter built
                      </Badge>
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip content="No adapter in this version. A credential here would make the screen look connected and still send nothing.">
                    <span className="cursor-help">
                      <Badge variant="warning" size="sm">
                        No adapter
                      </Badge>
                    </span>
                  </Tooltip>
                )}
                {p.canReceive ? (
                  <Tooltip content="Can read replies, so stop-on-reply works and enrolment is allowed.">
                    <span className="cursor-help">
                      <Badge variant="info" size="sm">
                        Reads replies
                      </Badge>
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip content="Send-only. Enrolment stays blocked, because a reply would never stop the sequence.">
                    <span className="cursor-help">
                      <Badge variant="warning" size="sm">
                        Send only
                      </Badge>
                    </span>
                  </Tooltip>
                )}
              </div>
              <p className="mt-0.5 text-2xs text-secondary">{p.suits}</p>
              <p className="text-2xs text-muted">
                <strong>Would need:</strong> {p.requires}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Shield className="size-3.5 text-muted" />
            Domain authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-2 text-2xs leading-relaxed text-muted">
            These are published in your domain&apos;s DNS, not here — nothing in this product can
            set them, and nothing can verify them until a provider is connected. They are listed
            because getting them wrong is the most common reason cold email lands in spam, and the
            failure is silent.
          </p>
          <div className="space-y-2">
            {domainChecks.map((c) => (
              <div
                key={c.record}
                className="rounded-md border border-border-subtle bg-surface px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-2xs font-medium text-primary">{c.record}</span>
                  <Badge variant="neutral" size="sm">
                    Not checked
                  </Badge>
                </div>
                <p className="mt-0.5 text-2xs text-secondary">{c.purpose}</p>
                <p className="text-2xs text-muted">
                  <strong>If it&apos;s wrong:</strong> {c.failureMode}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What works today instead</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-2xs leading-relaxed text-secondary">
          <p>
            <strong className="text-primary">Build and preview the sequence.</strong> Steps, delays,
            the send window and every template variable resolve against real leads, so you can see
            the exact message that would go out.{" "}
            <Link href="/outreach" className="text-brand-text underline-offset-2 hover:underline">
              Open Outreach
            </Link>
          </p>
          <p>
            <strong className="text-primary">Keep the suppression list clean.</strong> Opt-outs,
            bounces and do-not-contact entries are enforced now, so the list is correct before the
            first send rather than after it.{" "}
            <Link href="/trust" className="text-brand-text underline-offset-2 hover:underline">
              Trust Center
            </Link>
          </p>
          <p>
            <strong className="text-primary">Log replies you receive elsewhere.</strong> A reply
            recorded on the lead stops sequences and feeds reporting exactly as an automatic one
            would.{" "}
            <Link href="/inbox" className="text-brand-text underline-offset-2 hover:underline">
              Inbox
            </Link>
          </p>
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Credentials live in the server environment and are never read back into this screen — not
        even masked. Whether one is present is the only thing shown.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: number;
  hint?: string;
  muted?: boolean;
}) {
  const body = (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums ${muted ? "text-muted" : "text-primary"}`}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
  return hint ? (
    <Tooltip content={hint}>
      <div className="cursor-help">{body}</div>
    </Tooltip>
  ) : (
    body
  );
}
