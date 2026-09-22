"use client";

import { AlertTriangle, ArrowLeftRight, Check, Info, Link2, Radio, X } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";

type Provider = {
  name: string;
  label: string;
  connected: boolean;
  requires: string;
  syncs: string;
  direction: string;
};

/**
 * CRM integrations.
 *
 * Nothing is connected, and rather than a row of logos with dead "Connect"
 * buttons, this says what each one would need and — more usefully — what you
 * can already do instead, since the API and webhooks are real.
 */
export function CrmView({ providers }: { providers: Provider[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">CRM Integrations</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Two-way sync with the system of record, so this app can be the place work happens
          without becoming a second place the truth lives.
        </p>
      </div>

      <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-xs text-warning-text">
        <AlertTriangle className="mr-1 inline size-3.5" />
        <strong>No CRM is connected, and none of these are built yet.</strong> They are listed
        with what each would need so the gap is visible rather than implied by an empty screen.
        In the meantime the API and webhooks below are real and can carry the same data.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planned connectors</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {providers.map((p) => (
            <div
              key={p.name}
              className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <X className="size-3 text-muted" />
                <span className="text-xs font-medium text-primary">{p.label}</span>
                <Badge variant="neutral" size="sm">
                  Not built
                </Badge>
                <Tooltip content="Which way records would flow once it exists.">
                  <span className="cursor-help text-2xs text-muted">
                    <ArrowLeftRight className="mr-0.5 inline size-2.5" />
                    {p.direction}
                  </span>
                </Tooltip>
              </div>
              <p className="mt-0.5 text-2xs text-secondary">{p.syncs}</p>
              <p className="text-2xs text-muted">
                <strong>Would need:</strong> {p.requires}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What works today instead</CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              These are built and tested, not placeholders.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Check className="size-3 text-success-text" />
              <span className="text-xs font-medium text-primary">Pull data out with an API key</span>
            </div>
            <p className="mt-0.5 text-2xs text-secondary">
              Named, scoped keys read leads, the pipeline, tasks, proposals and reporting figures.
              A warehouse sync or a reverse-ETL job can read from here on a schedule.
            </p>
            <Link
              href="/settings/api-keys"
              className="mt-1 inline-block text-2xs text-accent-text hover:underline"
            >
              Issue a key →
            </Link>
          </div>

          <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Radio className="size-3 text-success-text" />
              <span className="text-xs font-medium text-primary">Push events out with webhooks</span>
            </div>
            <p className="mt-0.5 text-2xs text-secondary">
              Signed, retried delivery when a deal moves, a proposal is accepted or an agent holds
              an action. Enough to keep a CRM in step without a bespoke connector.
            </p>
            <Link
              href="/settings/webhooks"
              className="mt-1 inline-block text-2xs text-accent-text hover:underline"
            >
              Add an endpoint →
            </Link>
          </div>

          <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Link2 className="size-3 text-success-text" />
              <span className="text-xs font-medium text-primary">Bring a list in by hand</span>
            </div>
            <p className="mt-0.5 text-2xs text-secondary">
              CSV or TSV import with a dry run, duplicate detection and per-row rejection reasons.
              No points are charged for data you supply.
            </p>
            <Link href="/find-leads" className="mt-1 inline-block text-2xs text-accent-text hover:underline">
              Import a list →
            </Link>
          </div>
        </CardContent>
      </Card>

      <p className="text-2xs text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        A connector is more than an API call: it needs field mapping, conflict rules for when both
        sides change a record, and a decision about which system wins. That is why these are
        listed as not built rather than shipped half-working.
      </p>
    </div>
  );
}
