"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Ban,
  Copy,
  Contact as ContactIcon,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { VerificationBadge, TierBadge, ScorePill } from "@/components/domain/indicators";
import { RevealOneButton, RevealButton } from "@/components/leads/reveal-button";
import { formatDate } from "@/lib/format";
import { verificationMeaning, type TierKey } from "@/lib/vocab";
import { cn } from "@/lib/utils";

type ContactMethod = {
  id: string;
  kind: string;
  value: string | null;
  maskedValue: string;
  isLocked: boolean;
  isPrimary: boolean;
  status: string;
  confidence: number;
  source: string;
  verifiedAt: string | null;
  revealedAt: string | null;
  optedOutAt: string | null;
  bounceCount: number;
};

const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  WORK_EMAIL: { label: "Work email", icon: Mail },
  PERSONAL_EMAIL: { label: "Personal email", icon: Mail },
  MOBILE: { label: "Mobile", icon: Phone },
  DIRECT_PHONE: { label: "Direct line", icon: Phone },
  SWITCHBOARD: { label: "Switchboard", icon: Phone },
  LINKEDIN_URL: { label: "LinkedIn", icon: ContactIcon },
  WHATSAPP: { label: "WhatsApp", icon: Phone },
};

/**
 * §20 / §101 — a lead exists before its contact details are paid for. Locked
 * rows show the masked value, the source and the verification state so the user
 * knows exactly what a point buys before spending it. No fake badges.
 */
export function ContactPanel({
  contacts,
  leadName,
  leadId,
}: {
  contacts: ContactMethod[];
  leadName: string;
  leadId: string;
}) {
  const lockedCount = contacts.filter((c) => c.isLocked).length;
  const optedOut = contacts.some((c) => c.optedOutAt);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Contact details</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {contacts.length} on file · {lockedCount} locked
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {optedOut ? (
          <div className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2">
            <Ban className="mt-0.5 size-3.5 shrink-0 text-danger-text" />
            <p className="text-2xs leading-relaxed text-danger-text">
              This person has opted out of contact. Sends are blocked by the suppression list before
              they reach a provider, regardless of what is revealed here.
            </p>
          </div>
        ) : null}

        {contacts.length === 0 ? (
          <EmptyState
            compact
            icon={Mail}
            title="No contact details found"
            description={`Enrichment hasn't turned up a way to reach ${leadName}. Their LinkedIn profile may still be an option.`}
          />
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => {
              const meta = KIND_META[c.kind] ?? { label: c.kind, icon: Mail };
              const Icon = meta.icon;

              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-md border px-2.5 py-2",
                    c.optedOutAt
                      ? "border-danger-border bg-danger-subtle/40"
                      : c.isLocked
                        ? "border-dashed border-border-strong bg-surface-sunken"
                        : "border-border bg-surface"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("size-3.5 shrink-0", c.isLocked ? "text-muted" : "text-secondary")} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-2xs uppercase tracking-wider text-muted">
                          {meta.label}
                        </span>
                        {c.isPrimary ? (
                          <Badge size="sm" variant="neutral">
                            Primary
                          </Badge>
                        ) : null}
                        <VerificationBadge
                          status={c.status}
                          kind={c.kind}
                          verifiedAt={c.verifiedAt}
                        />
                      </div>

                      <p
                        className={cn(
                          "mt-0.5 truncate font-mono text-xs",
                          c.isLocked ? "text-muted" : "text-primary"
                        )}
                      >
                        {c.isLocked ? c.maskedValue : (c.value ?? c.maskedValue)}
                      </p>
                    </div>

                    {c.isLocked ? (
                      <RevealOneButton
                        leadId={leadId}
                        contactMethodId={c.id}
                        kindLabel={meta.label}
                      />
                    ) : c.value ? (
                      <Tooltip content="Copy to clipboard">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Copy ${meta.label}`}
                          onClick={() => {
                            void navigator.clipboard.writeText(c.value!);
                            toast.success(`${meta.label} copied`);
                          }}
                        >
                          <Copy />
                        </Button>
                      </Tooltip>
                    ) : null}
                  </div>

                  {/* Provenance, always visible (§101) */}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted">
                    <span>Source: {c.source}</span>
                    <span>·</span>
                    <span>{c.confidence}% confidence</span>
                    {c.verifiedAt ? (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <ShieldCheck className="size-2.5" />
                          Checked {formatDate(c.verifiedAt)}
                        </span>
                      </>
                    ) : null}
                    {c.bounceCount > 0 ? (
                      <>
                        <span>·</span>
                        <span className="text-danger-text">
                          {c.bounceCount} bounce{c.bounceCount === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-muted/80">
                    {verificationMeaning(c.status, c.kind)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {lockedCount > 0 ? (
        <CardFooter className="flex-wrap gap-2">
          <RevealButton
            leadId={leadId}
            lockedCount={lockedCount}
            label={`Reveal all ${lockedCount}`}
            variant="secondary"
          />
          <p className="flex items-center gap-1 text-2xs text-muted">
            <Lock className="size-3" />
            You are shown the exact price before any point is spent.
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

type Colleague = {
  personId: string;
  name: string;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  title: string;
  department: string | null;
  seniority: string | null;
  isDecisionMaker: boolean;
  committeeRole: string | null;
  committeeConfirmed: boolean;
  committeeAiSuggested: boolean;
  influence: number | null;
  contactState: string;
  leadId: string | null;
  leadTier: string | null;
  leadScore: number | null;
};

const COMMITTEE_LABEL: Record<string, { label: string; variant: "brand" | "success" | "info" | "warning" | "danger" | "neutral" }> = {
  CHAMPION: { label: "Champion", variant: "success" },
  DECISION_MAKER: { label: "Decision maker", variant: "brand" },
  INFLUENCER: { label: "Influencer", variant: "info" },
  TECHNICAL_EVALUATOR: { label: "Technical", variant: "info" },
  FINANCE: { label: "Finance", variant: "warning" },
  PROCUREMENT: { label: "Procurement", variant: "warning" },
  BLOCKER: { label: "Blocker", variant: "danger" },
  UNKNOWN: { label: "Unknown role", variant: "neutral" },
};

/** §28 / §60 — other people at the account, with their committee role. */
export function ReachableColleagues({
  colleagues,
  companyName,
}: {
  colleagues: Colleague[];
  companyName: string;
}) {
  const ranked = [...colleagues].sort((a, b) => {
    if (a.isDecisionMaker !== b.isDecisionMaker) return a.isDecisionMaker ? -1 : 1;
    return (b.influence ?? 0) - (a.influence ?? 0);
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Others at {companyName}</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">
            {colleagues.length} known {colleagues.length === 1 ? "person" : "people"} · single-threaded
            deals are fragile
          </p>
        </div>
      </CardHeader>

      <CardContent>
        {ranked.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="No other contacts known"
            description="Only one person at this account is on record. Finding a second stakeholder materially improves the odds on a deal this size."
          />
        ) : (
          <ul className="space-y-1.5">
            {ranked.map((c) => {
              const committee = c.committeeRole ? COMMITTEE_LABEL[c.committeeRole] : null;
              return (
                <li
                  key={c.personId}
                  className="flex items-center gap-2.5 rounded-md border border-border-subtle px-2.5 py-2 transition-colors hover:bg-surface-hover"
                >
                  <Avatar name={c.name} src={c.avatarUrl} size="sm" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.leadId ? (
                        <Link
                          href={`/leads/${c.leadId}`}
                          className="truncate text-xs font-medium text-primary hover:text-brand-text"
                        >
                          {c.name}
                        </Link>
                      ) : (
                        <span className="truncate text-xs font-medium text-primary">{c.name}</span>
                      )}
                      {c.leadTier ? <TierBadge tier={c.leadTier as TierKey} size="sm" /> : null}
                      {c.leadScore !== null ? <ScorePill score={c.leadScore} /> : null}
                    </div>
                    <p className="truncate text-2xs text-secondary">{c.title}</p>

                    {committee ? (
                      <Tooltip
                        content={
                          c.committeeConfirmed
                            ? "Role confirmed by someone on your team."
                            : "Suggested from title and signal context. Confirm before relying on it."
                        }
                      >
                        <span className="mt-0.5 inline-flex items-center gap-1">
                          <Badge size="sm" variant={committee.variant}>
                            {committee.label}
                          </Badge>
                          {!c.committeeConfirmed && c.committeeAiSuggested ? (
                            <span className="text-2xs text-muted">suggested</span>
                          ) : null}
                        </span>
                      </Tooltip>
                    ) : null}
                  </div>

                  {c.contactState === "locked" && c.leadId ? (
                    <RevealButton
                      leadId={c.leadId}
                      lockedCount={1}
                      label="1 point"
                      variant="subtle"
                    />
                  ) : c.contactState === "locked" ? (
                    <Tooltip content="This person isn't tracked as a lead yet, so there's nothing to reveal against.">
                      <span className="text-2xs text-muted">Not a lead</span>
                    </Tooltip>
                  ) : c.contactState === "open" ? (
                    <Badge variant="success" size="sm" uppercase>
                      Revealed
                    </Badge>
                  ) : (
                    <Tooltip content="No email or phone on file for this person">
                      <span className="text-2xs text-muted">No contact</span>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
