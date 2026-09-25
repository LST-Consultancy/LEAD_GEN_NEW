"use client";

import Link from "next/link";
import { AlertTriangle, Check, CircleHelp, ExternalLink, Info, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemCheck } from "@/lib/services/support";
import { SupportRequests, type SupportRequestRow } from "@/components/admin/support-requests";

const STATE = {
  ok: { icon: Check, variant: "success" as const, label: "Working" },
  degraded: { icon: AlertTriangle, variant: "warning" as const, label: "Partly working" },
  off: { icon: X, variant: "neutral" as const, label: "Not connected" },
};

/**
 * §100 — support.
 *
 * Leads with live diagnostics rather than a contact form, because most "it
 * isn't working" is an unconnected provider and the answer is on this screen
 * before anyone writes a message.
 */
export function SupportView({
  checks,
  workspaceSlug,
  requests,
  isAdmin,
}: {
  checks: SystemCheck[];
  workspaceSlug: string;
  requests: SupportRequestRow[];
  isAdmin: boolean;
}) {
  const off = checks.filter((c) => c.state !== "ok");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">Support</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          What this workspace has connected right now. Most of the time &ldquo;it isn&apos;t
          working&rdquo; turns out to be one of these, so start here.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <CircleHelp className="size-3.5 text-muted" />
            System check
          </CardTitle>
          <span className="text-2xs text-muted">
            {off.length === 0
              ? "everything connected"
              : `${off.length} of ${checks.length} not fully connected`}
          </span>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0">
          {checks.map((c) => {
            const meta = STATE[c.state];
            const Icon = meta.icon;
            return (
              <div
                key={c.name}
                className="rounded-md border border-border-subtle bg-surface px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Icon className="size-3 text-muted" />
                  <span className="text-xs font-medium text-primary">{c.name}</span>
                  <Badge variant={meta.variant} size="sm">
                    {meta.label}
                  </Badge>
                </div>
                <p className="mt-0.5 text-2xs leading-relaxed text-secondary">{c.detail}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-2xs leading-relaxed text-secondary">
          <Answer
            q="Why did my sequence not send anything?"
            a="Email sends only once a sending mailbox is connected in Settings → Email Accounts (SMTP, Google or Microsoft 365), or the server relay is configured — check System status above. WhatsApp and LinkedIn sequence steps are manual tasks: WhatsApp messages are sent one at a time from the lead through the Business Cloud API, and LinkedIn has no automated sending. Open the sequence: every enrollment shows whether it is waiting on the clock, held on configuration, or stopped because that person cannot be contacted."
            href="/outreach"
            hrefLabel="Open Outreach"
          />
          <Answer
            q="Why is a lead's contact hidden?"
            a="Contact details are locked until revealed, which spends points. The masked form tells you the shape of the value so you can judge whether it is worth revealing."
            href="/settings/billing"
            hrefLabel="Billing & Points"
          />
          <Answer
            q="Why does a figure differ from what I expected?"
            a="Every number on screen traces to rows, and anything resting on an assumption states it next to the figure. If a statistic would need data that isn't there, it is withheld rather than shown as zero — a reply rate over no sends is blank, not 0%."
            href="/insights"
            hrefLabel="Insights"
          />
          <Answer
            q="An agent did nothing. Is it broken?"
            a="Check whether it is inert: an agent whose every tool is unbuilt or undefined cannot be enabled, and says so. If it ran but held actions, those are waiting for approval."
            href="/approvals"
            hrefLabel="Approvals"
          />
          <Answer
            q="I deleted something by mistake."
            a="Nothing is hard-deleted. It is in the recycle bin with the date its data is actually removed, and most types restore from there."
            href="/recycle-bin"
            hrefLabel="Recycle Bin"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ask for help</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <SupportRequests initial={requests} isAdmin={isAdmin} />
          <p className="text-2xs leading-relaxed text-secondary">
            Include the workspace slug <span className="font-mono text-primary">{workspaceSlug}</span>{" "}
            and, if the app showed you a reference, that reference. Every request
            carries an id, and an error that quotes one can be found on a single log line —
            &ldquo;it broke this afternoon&rdquo; cannot. Otherwise: what you expected, what
            happened, and roughly when. The{" "}
            <Link
              href="/settings/audit"
              className="text-brand-text underline-offset-2 hover:underline"
            >
              Audit Log
            </Link>{" "}
            records every change with its before and after, and{" "}
            <Link href="/settings/jobs" className="text-brand-text underline-offset-2 hover:underline">
              Background Jobs
            </Link>{" "}
            shows what has and hasn&apos;t run — between them they usually answer it.
          </p>
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        See{" "}
        <Link href="/whats-new" className="text-brand-text underline-offset-2 hover:underline">
          What&apos;s New
        </Link>{" "}
        for what has shipped and what each thing still cannot do.
      </p>
    </div>
  );
}

function Answer({
  q,
  a,
  href,
  hrefLabel,
}: {
  q: string;
  a: string;
  href: string;
  hrefLabel: string;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
      <p className="text-xs font-medium text-primary">{q}</p>
      <p className="mt-0.5 text-2xs leading-relaxed text-secondary">{a}</p>
      <Link
        href={href}
        className="mt-1 inline-flex items-center gap-1 text-2xs text-brand-text underline-offset-2 hover:underline"
      >
        {hrefLabel}
        <ExternalLink className="size-2.5" />
      </Link>
    </div>
  );
}
