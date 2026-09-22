"use client";

import Link from "next/link";
import { Ban, Check, Contact, ExternalLink, Info, Lock, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { formatAge, formatNumber } from "@/lib/format";
import { ASSISTED_FLOW, SANCTIONED_OPTIONS, WILL_NOT_DO } from "@/lib/channels/linkedin";
import type { ChannelReach } from "@/lib/services/channels";

type Target = {
  leadId: string;
  name: string;
  headline: string | null;
  companyName: string;
  industry: string | null;
  score: number;
  surfacedReason: string;
  lastContactedAt: string | null;
  profileUrl: string | null;
  maskedUrl: string;
  isLocked: boolean;
};

/**
 * LinkedIn — the channel screen and its settings screen.
 *
 * The honest position is the product position: there is no sanctioned API for
 * third-party sending, so this prepares the work and the person performs it.
 * `WILL_NOT_DO` is stated as a commitment rather than a gap, because "not built
 * yet" would imply automation is coming when it deliberately is not.
 */
export function LinkedInView({
  variant,
  reach,
  targets,
}: {
  variant: "channel" | "settings";
  reach: ChannelReach;
  targets: Target[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">
          {variant === "channel" ? "LinkedIn" : "LinkedIn settings"}
        </h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          Assisted, not automated. This product prepares the context and you send the message
          yourself, in LinkedIn, from your own session — there is nothing to connect and no
          credential to hand over.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-xs text-secondary">
        <Info className="mr-1 inline size-3.5 text-muted" />
        <strong className="text-primary">Why there is no &ldquo;Connect LinkedIn&rdquo; button.</strong>{" "}
        LinkedIn publishes no API that lets a third-party tool send connection requests or
        messages. Products that appear to do it drive a browser against a logged-in session, which
        breaks LinkedIn&apos;s terms and risks <em>your</em> account, not the vendor&apos;s. So the
        automation is not built, and it is not planned.
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Contact className="size-3.5 text-muted" />
            Who you could reach
          </CardTitle>
          <span className="text-2xs text-muted">across leads you can see</span>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 sm:grid-cols-3">
            <Figure label="Leads" value={reach.totalLeads} />
            <Figure
              label="With a profile URL"
              value={reach.reachable}
              hint="A LinkedIn URL recorded on the contact. Nothing is looked up or scraped to find one."
            />
            <Figure
              label="Revealed"
              value={reach.revealed}
              hint="A locked URL is masked until revealed, so it can't be used as a way around the reveal."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the assisted flow works</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-2 text-2xs leading-relaxed text-muted">
            The <em>Who</em> column is the point of this table.
          </p>
          <ol className="space-y-1.5">
            {ASSISTED_FLOW.map((step) => (
              <li key={step.order} className="flex items-start gap-2">
                <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-2xs tabular-nums text-muted">
                  {step.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-primary">{step.title}</span>
                    <Badge variant={step.actor === "app" ? "info" : "neutral"} size="sm">
                      {step.actor === "app" ? "This app" : "You, in LinkedIn"}
                    </Badge>
                  </div>
                  <p className="text-2xs leading-relaxed text-secondary">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {variant === "channel" ? (
        <Card>
          <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Ready to work</CardTitle>
            <span className="text-2xs text-muted">highest scoring first</span>
          </CardHeader>
          <CardContent className="pt-0">
            {targets.length === 0 ? (
              <EmptyState
                icon={User}
                compact
                title="No lead has a LinkedIn URL recorded"
                description="A URL gets here from an import or from a contact you added by hand. Nothing searches LinkedIn to find one."
              />
            ) : (
              <div className="space-y-1.5">
                {targets.map((t) => (
                  <div
                    key={t.leadId}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-primary">{t.name}</span>
                        <span className="truncate text-2xs text-muted">{t.companyName}</span>
                        <span className="tabular-nums text-2xs text-muted">
                          {t.score.toFixed(1)}
                        </span>
                        {t.lastContactedAt ? (
                          <Badge variant="neutral" size="sm">
                            touched {formatAge(t.lastContactedAt)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-2xs text-secondary">
                        {t.headline ?? "No title recorded"} — {t.surfacedReason}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/leads/${t.leadId}`}>Context</Link>
                      </Button>
                      {t.isLocked ? (
                        <Tooltip content="This URL is locked. Reveal it on the lead to open the profile.">
                          <span className="flex cursor-help items-center gap-1 px-2 text-2xs text-muted">
                            <Lock className="size-3" />
                            {t.maskedUrl}
                          </span>
                        </Tooltip>
                      ) : (
                        <Button asChild size="sm" variant="secondary">
                          <a href={t.profileUrl ?? "#"} target="_blank" rel="noreferrer noopener">
                            Open profile
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-2xs leading-relaxed text-muted">
              Opening a profile is an ordinary link. Record the touch on the lead afterwards and it
              lands on the timeline like any other — reporting and stop-on-reply treat it the same.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Ban className="size-3.5 text-muted" />
            What this product will not do
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="space-y-1">
            {WILL_NOT_DO.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-2xs text-secondary">
                <Ban className="mt-0.5 size-3 shrink-0 text-danger-text" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs leading-relaxed text-muted">
            These are commitments, not a roadmap. If a paid automation add-on is ever offered it
            would sit behind its own permission and say plainly whose account carries the risk.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Check className="size-3.5 text-muted" />
            Sanctioned routes, if you need volume
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {SANCTIONED_OPTIONS.map((o) => (
            <div key={o.label} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
              <p className="text-xs font-medium text-primary">{o.label}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-secondary">{o.allows}</p>
              <p className="text-2xs text-muted">
                <strong>Requires:</strong> {o.requires}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  const body = (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
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
