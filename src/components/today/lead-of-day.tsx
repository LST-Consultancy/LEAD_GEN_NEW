"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Ban,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  Unlock,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardEyebrow } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { IntentBadge, ScoreDial, TierBadge } from "@/components/domain/indicators";
import { formatAge, formatInrCompact, hoursSince } from "@/lib/format";
import { SIGNAL_SOURCE_LABEL, SIGNAL_TYPE_LABEL, type IntentKey, type TierKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";
import { RevealButton } from "@/components/leads/reveal-button";
import { StarToggle } from "@/components/leads/dossier/lead-actions";

type LeadOfDay = {
  id: string;
  tier: string;
  intent: string;
  status: string;
  score: number;
  isStarred: boolean;
  estimatedBudgetInr: number | null;
  surfacedAt: string;
  surfacedReason: string;
  person: {
    name: string;
    avatarUrl: string | null;
    linkedinUrl: string | null;
    title: string;
    isDecisionMaker: boolean;
    location: string;
  };
  company: {
    id: string;
    name: string;
    industry: string | null;
    location: string;
    employeeCount: number | null;
    domain: string | null;
  };
  signal: {
    id: string;
    type: string;
    sourceName: string;
    sourceUrl: string | null;
    title: string;
    excerpt: string;
    interpretation: string | null;
    confidence: number;
    suggestedAction: string | null;
    occurredAt: string;
  } | null;
  channels: { email: string; phone: string; linkedin: string };
  nextBestAction: { label: string; rationale: string } | null;
};

/** §7 — the one lead the system would open first, with the reason attached. */
export function LeadOfTheDay({ lead }: { lead: LeadOfDay | null }) {
  // Dismissal is a personal, per-day preference, so it lives in this browser for the rest of the day.
  // The key is built only in effects and handlers: reading the clock during render risks a hydration mismatch.
  const leadId = lead?.id ?? "none";
  const dismissKey = React.useCallback(() => `sr-lod-dismissed:${leadId}:${new Date().toDateString()}`, [leadId]);
  const [dismissed, setDismissedState] = React.useState(false);
  React.useEffect(() => { try { setDismissedState(localStorage.getItem(dismissKey()) === "1"); } catch { /* storage unavailable */ } }, [dismissKey]);
  const setDismissed = (value: boolean) => { setDismissedState(value); try { if (value) localStorage.setItem(dismissKey(), "1"); else localStorage.removeItem(dismissKey()); } catch { /* storage unavailable */ } };

  if (!lead) {
    return (
      <Card>
        <EmptyState
          compact
          icon={Sparkles}
          title="No lead to surface today"
          description="Nothing in your workspace has both a buying signal and an unworked status. Add a search phrase to widen what gets watched."
          action={
            <Button size="sm" variant="primary" asChild>
              <Link href="/find-leads">Set up lead discovery</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  if (dismissed) {
    return (
      <Card>
        <EmptyState
          compact
          icon={Ban}
          title="Dismissed for today"
          description="This lead stays in your list — it just won't be surfaced here again today."
          action={
            <Button size="sm" variant="ghost" onClick={() => setDismissed(false)}>
              Undo
            </Button>
          }
        />
      </Card>
    );
  }

  const signalAgeHours = lead.signal ? hoursSince(lead.signal.occurredAt) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-2">
        <CardEyebrow>Lead of the day</CardEyebrow>
        {signalAgeHours !== null && signalAgeHours < 24 ? (
          <Badge variant="warning" size="sm" uppercase>
            <Clock />
            Signal {signalAgeHours}h old
          </Badge>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={lead.person.name} src={lead.person.avatarUrl} size="xl" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={`/leads/${lead.id}`}
                className="truncate text-base font-semibold tracking-tight text-primary hover:text-brand-text"
              >
                {lead.person.name}
              </Link>
              <TierBadge tier={lead.tier as TierKey} />
              <IntentBadge intent={lead.intent as IntentKey} />
              {lead.person.isDecisionMaker ? (
                <Badge variant="brand" size="sm" uppercase>
                  Decision maker
                </Badge>
              ) : null}
            </div>

            <p className="mt-0.5 truncate text-xs text-secondary">
              {lead.person.title} ·{" "}
              <Link href={`/accounts/${lead.company.id}`} className="hover:text-brand-text">
                {lead.company.name}
              </Link>
            </p>
            <p className="mt-0.5 truncate text-2xs text-muted">
              {[
                lead.company.industry,
                lead.company.location || lead.person.location,
                lead.company.employeeCount ? `${lead.company.employeeCount} employees` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1">
            <ScoreDial score={lead.score} size="lg" />
            <Link
              href={`/leads/${lead.id}#why`}
              className="text-2xs text-muted underline decoration-dotted underline-offset-2 hover:text-brand-text"
            >
              Why {lead.score}?
            </Link>
          </div>
        </div>

        {/* Why today — the signal itself, quoted with its source. */}
        {lead.signal ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-brand-text">
                Why today?
              </span>
              <Badge size="sm" variant="outline">
                {SIGNAL_TYPE_LABEL[lead.signal.type] ?? lead.signal.type}
              </Badge>
              <span className="text-2xs text-muted">
                {SIGNAL_SOURCE_LABEL[lead.signal.sourceName] ?? lead.signal.sourceName} ·{" "}
                {formatAge(lead.signal.occurredAt)} · {lead.signal.confidence}% confidence
              </span>
            </div>

            <blockquote className="mt-2 border-l-2 border-brand-border pl-2.5 text-xs italic leading-relaxed text-secondary">
              “{lead.signal.excerpt}”
            </blockquote>

            {lead.signal.interpretation ? (
              <p className="mt-2 flex gap-1.5 text-2xs leading-relaxed text-muted">
                <Sparkles className="mt-0.5 size-3 shrink-0 text-ai-accent" />
                {lead.signal.interpretation}
              </p>
            ) : null}

            {lead.signal.sourceUrl ? (
              <a
                href={lead.signal.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1 text-2xs text-brand-text hover:underline"
              >
                View source
                <ExternalLink className="size-2.5" />
              </a>
            ) : null}
          </div>
        ) : null}

        {/* Facts row */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Fact label="Estimated value" value={lead.estimatedBudgetInr ? formatInrCompact(lead.estimatedBudgetInr) : "Not established"} />
          <Fact label="Surfaced" value={formatAge(lead.surfacedAt)} />
          <Fact label="Status" value={lead.status.toLowerCase()} capitalize />
          <Fact
            label="Reachable"
            value={
              lead.channels.email === "open"
                ? "Email ready"
                : lead.channels.email === "locked"
                  ? "1 point to unlock"
                  : "No channel yet"
            }
          />
        </dl>

        {lead.nextBestAction ? (
          <div className="mt-3 flex gap-2 rounded-md border border-brand-border bg-brand-subtle px-3 py-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
            <p className="text-xs leading-relaxed text-brand-text">
              <strong>{lead.nextBestAction.label}.</strong> {lead.nextBestAction.rationale}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle bg-surface-sunken px-4 py-2.5">
        <Button variant="primary" size="sm" asChild>
          <Link href={`/leads/${lead.id}`}>Open dossier</Link>
        </Button>

        <ChannelButton leadId={lead.id} mode="email" state={lead.channels.email} icon={Mail} label="Email" />
        <ChannelButton leadId={lead.id} mode="call" state={lead.channels.phone} icon={Phone} label="Call" />
        <ChannelButton leadId={lead.id} mode="whatsapp" state={lead.channels.phone} icon={MessageCircle} label="WhatsApp" />

        {lead.person.linkedinUrl ? (
          <Tooltip content="Open their LinkedIn profile in a new tab">
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={lead.person.linkedinUrl} target="_blank" rel="noreferrer noopener" aria-label="Open LinkedIn profile">
                <ExternalLink />
              </a>
            </Button>
          </Tooltip>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <Tooltip content="Add to a proposal">
            <Button variant="ghost" size="icon-sm" aria-label="Create proposal" asChild>
              <Link href={`/proposals/new?leadId=${lead.id}`}>
                <FileText />
              </Link>
            </Button>
          </Tooltip>
          <StarToggle leadId={lead.id} initial={lead.isStarred} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDismissed(true);
              toast("Dismissed for today", {
                description: `${lead.person.name} stays in your leads list.`,
                action: { label: "Undo", onClick: () => setDismissed(false) },
              });
            }}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Fact({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cn("truncate text-xs font-medium text-primary", capitalize && "capitalize")}>
        {value}
      </dd>
    </div>
  );
}

/**
 * A channel button reflects reality: open, locked behind a point, or absent.
 * A locked channel says so rather than failing silently when clicked (§126).
 */
function ChannelButton({
  leadId,
  mode,
  state,
  icon: Icon,
  label,
}: {
  leadId: string;
  mode: "email" | "call" | "whatsapp";
  state: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  if (state === "none") {
    return (
      <Tooltip content={`No ${label.toLowerCase()} channel on file for this person.`}>
        <Button variant="ghost" size="icon-sm" disabled aria-label={`${label} unavailable`}>
          <Icon />
        </Button>
      </Tooltip>
    );
  }
  if (state === "locked") {
    return <RevealButton leadId={leadId} lockedCount={1} variant="subtle" label={label} />;
  }
  return (
    <Tooltip content={`${label} — contact already revealed, no points needed`}>
      <Button variant="secondary" size="sm" asChild>
        <Link href={`/leads/${leadId}?do=${mode}`}>
          <Unlock className="size-3" />
          {label}
        </Link>
      </Button>
    </Tooltip>
  );
}
